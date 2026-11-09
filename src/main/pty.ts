// Owns one zsh process per terminal tab. Output is batched before it goes to
// the renderer, and the shell is paused while the renderer falls behind.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import * as pty from 'node-pty';

/** Pause the shell when this many characters are sent but not yet drawn. */
const HIGH_WATER = 512 * 1024;
/** Resume once the renderer is back under this. */
const LOW_WATER = 128 * 1024;
/**
 * Output kept per tab so a reloaded renderer can redraw recent history. It is
 * raw output, so terminal modes set before it starts (bracketed paste, the
 * alternate screen) are not replayed; a proper fix is a headless terminal in
 * the main process, planned with scrollback replay.
 */
const REPLAY_LIMIT = 256 * 1024;
/** How long a closed tab's shell gets to exit after SIGHUP before it is killed. */
const KILL_GRACE_MS = 3000;
/** How often batched output is sent to the renderer. */
const FLUSH_MS = 8;

/** How a shell ended. `clean` means it exited normally with code 0 (you typed `exit`), not killed by a signal. */
export interface PtyExit {
  code: number;
  clean: boolean;
}

export interface PtySink {
  data(tabId: string, data: string): void;
  exit(tabId: string, exit: PtyExit): void;
}

interface Entry {
  proc: pty.IPty;
  replay: string;
  pending: string;
  unacked: number;
  paused: boolean;
  /** False while no window is showing this tab's output (closed or reloading). */
  attached: boolean;
  /** Set once the shell has ended. The entry stays, with its output, until the tab restarts it or closes. */
  exited?: PtyExit;
  listeners: pty.IDisposable[];
  /** Whether anything has been typed into this shell yet. */
  typed: boolean;
}

export interface SpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
}

/** Variables that must not leak from the app's own environment into tab shells. */
const STRIPPED_ENV = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_RENDERER_URL',
  'NODE_OPTIONS',
  'AI_AGENT',
];

/**
 * If Humanloop was started from inside a Claude Code session, that session's
 * markers would make every `claude` in a tab think it is a child session, so
 * they are removed. Claude's configuration is kept: CLAUDE_CONFIG_DIR,
 * CLAUDE_CODE_USE_BEDROCK and the like, and ANTHROPIC_* (gateway URL, keys).
 */
const CLAUDE_SESSION_MARKERS = /^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|SSE_PORT|EXECPATH|PARENT_\w+))$/;

function stripped(name: string): boolean {
  return STRIPPED_ENV.includes(name) || CLAUDE_SESSION_MARKERS.test(name) || name.startsWith('HUMANLOOP_');
}

export function shellEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || stripped(k)) continue;
    env[k] = v;
  }
  return {
    ...env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: env.LANG || 'en_US.UTF-8',
    ...extra,
  };
}

/** Falls back to the home directory when the requested one is missing. */
export function usableCwd(dir: string | undefined): string {
  if (dir) {
    const expanded = dir.startsWith('~') ? homedir() + dir.slice(1) : dir;
    try {
      if (existsSync(expanded) && statSync(expanded).isDirectory()) return expanded;
    } catch {
      // fall through
    }
  }
  return homedir();
}

export class PtyManager {
  private entries = new Map<string, Entry>();
  /** What closed tabs left to force-kill, until their grace period ends (quitting does it at once). */
  private pendingKills = new Set<KillTarget[]>();
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(private sink: PtySink) {}

  has(tabId: string): boolean {
    const e = this.entries.get(tabId);
    return !!e && e.exited === undefined;
  }

  /**
   * Starts the tab's shell if it has none, and returns recent output so the
   * renderer can redraw it. A shell that ended while nothing was showing it
   * is reported with its output, not silently replaced; `restart` starts a
   * new one in its place.
   */
  attach(tabId: string, opts: SpawnOptions, restart = false): { replay: string; exited?: PtyExit } {
    const existing = this.entries.get(tabId);
    if (existing && (existing.exited === undefined || !restart)) {
      // The replay already contains anything still pending, so drop it to
      // avoid drawing the same output twice.
      existing.pending = '';
      existing.attached = true;
      existing.unacked = 0;
      const replay = replayFrom(existing.replay);
      if (existing.exited) return { replay, exited: existing.exited };
      this.updatePause(existing);
      this.resize(tabId, opts.cols, opts.rows);
      return { replay };
    }
    this.spawn(tabId, opts);
    return { replay: '' };
  }

  private spawn(tabId: string, opts: SpawnOptions): void {
    // A login shell picks up PATH from the user's profile, which matters when
    // the app was opened from Finder with launchd's minimal environment.
    const proc = pty.spawn('/bin/zsh', ['-l'], {
      name: 'xterm-256color',
      cols: size(opts.cols, 80, 2),
      rows: size(opts.rows, 24, 1),
      cwd: opts.cwd,
      env: opts.env,
    });
    // A restart replaces an exited shell; its listeners go with it.
    for (const l of this.entries.get(tabId)?.listeners ?? []) l.dispose();
    const entry: Entry = { proc, replay: '', pending: '', unacked: 0, paused: false, attached: true, listeners: [], typed: false };
    this.entries.set(tabId, entry);

    entry.listeners.push(
      proc.onData((data) => {
        entry.replay += data;
        // Trimmed in batches, so heavy output doesn't copy the whole buffer on every chunk.
        if (entry.replay.length > REPLAY_LIMIT * 2) entry.replay = entry.replay.slice(-REPLAY_LIMIT);
        entry.pending += data;
        this.scheduleFlush();
      }),
      proc.onExit(({ exitCode, signal }) => {
        entry.exited = { code: exitCode, clean: exitCode === 0 && !signal };
        this.flush();
        this.sink.exit(tabId, entry.exited);
      }),
    );
  }

  write(tabId: string, data: string): void {
    const e = this.entries.get(tabId);
    if (!e || e.exited !== undefined) return;
    e.typed = true;
    e.proc.write(data);
  }

  /** Whether anything has been typed into the tab's shell since it started. */
  typedInto(tabId: string): boolean {
    return this.entries.get(tabId)?.typed ?? false;
  }

  /**
   * The program running in the tab, if the shell isn't sitting at its prompt:
   * a foreground job (\`claude\`, \`vim\`, or a \`bash script.sh\` whose name
   * alone would look like a shell), or a program that replaced the shell
   * with \`exec\`. Undefined at a prompt, or if the shell has exited.
   */
  busyProgram(tabId: string): string | undefined {
    return this.busyPrograms([tabId]).get(tabId);
  }

  /** busyProgram for several tabs, with one process-table read for all of them. */
  busyPrograms(tabIds: string[]): Map<string, string> {
    const live = tabIds.flatMap((id) => {
      const e = this.entries.get(id);
      return e && e.exited === undefined ? [{ id, pid: e.proc.pid, name: this.foregroundProcess(id) || 'A program' }] : [];
    });
    const busy = new Map<string, string>();
    if (!live.length) return busy;
    const groups = processGroups();
    for (const { id, pid, name } of live) {
      const looksLikeShell = /^-?(zsh|bash|sh|login)$/.test(name);
      const g = groups?.get(pid);
      // tpgid: the process group in the terminal's foreground; pgid: the shell's own.
      // After `exec`, the program owns the shell's group, so its name tells.
      if ((g && g.tpgid !== g.pgid) || !looksLikeShell) busy.set(id, name);
    }
    return busy;
  }

  resize(tabId: string, cols: number, rows: number): void {
    const e = this.entries.get(tabId);
    if (!e || e.exited !== undefined) return;
    try {
      e.proc.resize(size(cols, e.proc.cols, 2), size(rows, e.proc.rows, 1));
    } catch {
      // The process can exit between the check and the resize.
    }
  }

  /** The renderer has drawn this many characters. */
  ack(tabId: string, chars: number): void {
    const e = this.entries.get(tabId);
    if (!e || !Number.isFinite(chars) || chars < 0) return;
    e.unacked = Math.max(0, e.unacked - chars);
    this.updatePause(e);
  }

  /** Name of the program in the foreground of the tab, e.g. "zsh" or "claude". */
  foregroundProcess(tabId: string): string | undefined {
    const e = this.entries.get(tabId);
    if (!e || e.exited !== undefined) return undefined;
    try {
      return e.proc.process;
    } catch {
      return undefined;
    }
  }

  /** The current directory of the tab's shell (wherever you last cd'd), from the system. */
  cwd(tabId: string): Promise<string | undefined> {
    const e = this.entries.get(tabId);
    if (!e || e.exited !== undefined) return Promise.resolve(undefined);
    return new Promise((done) => {
      execFile('/usr/sbin/lsof', ['-a', '-p', String(e.proc.pid), '-d', 'cwd', '-Fn'], { timeout: 2000 }, (err, stdout) => {
        const line = err ? undefined : String(stdout).split('\n').find((l) => l.startsWith('n'));
        done(line ? line.slice(1) : undefined);
      });
    });
  }

  pid(tabId: string): number | undefined {
    return this.entries.get(tabId)?.proc.pid;
  }

  /**
   * Ends the tab's shell: SIGHUP, like closing a terminal window, then SIGKILL
   * if it's still there a few seconds later (a shell that ignores SIGHUP).
   * Its output is no longer collected.
   */
  kill(tabId: string): void {
    const targets = this.hangUp(tabId);
    if (!targets.length) return;
    this.pendingKills.add(targets);
    setTimeout(() => {
      this.pendingKills.delete(targets);
      forceKill(targets);
    }, KILL_GRACE_MS).unref();
  }

  /**
   * Sends SIGHUP to the tab's shell, as closing a terminal window does, and
   * forgets the tab. Returns what to force-kill if it's still there later:
   * the shell and its foreground job (as a process group). Jobs you put in
   * the background with nohup or disown are left to run, as in Terminal.
   */
  private hangUp(tabId: string): KillTarget[] {
    const e = this.entries.get(tabId);
    this.entries.delete(tabId);
    if (!e) return [];
    for (const l of e.listeners) l.dispose();
    if (e.exited !== undefined) return [];
    const pid = e.proc.pid;
    const g = processGroups([pid])?.get(pid);
    const targets: KillTarget[] = [{ pid }];
    if (g && g.tpgid > 0 && g.tpgid !== g.pgid) targets.push({ pgid: g.tpgid });
    try {
      e.proc.kill('SIGHUP');
    } catch {
      // already gone
    }
    return targets;
  }

  /**
   * The window closed or is reloading. Shells keep running and their output
   * goes only to the replay buffer, so nothing pauses waiting for acks that
   * will never come. Each tab re-attaches when it is next shown.
   */
  detachAll(): void {
    for (const e of this.entries.values()) {
      e.attached = false;
      e.pending = '';
      e.unacked = 0;
      if (e.exited === undefined) this.updatePause(e);
    }
  }

  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id);
  }

  /**
   * For quitting: hangs up every shell, waits up to \`graceMs\` for them (and
   * tabs closed in the last few seconds) to exit, then force-kills what's
   * left, so nothing that ignores SIGHUP outlives the app.
   */
  async shutdown(graceMs = 1500): Promise<void> {
    const targets = [...[...this.entries.keys()].flatMap((id) => this.hangUp(id)), ...[...this.pendingKills].flat()];
    this.pendingKills.clear();
    const deadline = Date.now() + graceMs;
    while (targets.some(running) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    forceKill(targets);
  }

  private updatePause(e: Entry): void {
    if (!e.paused && e.unacked > HIGH_WATER) {
      e.paused = true;
      e.proc.pause();
    } else if (e.paused && e.unacked < LOW_WATER) {
      e.paused = false;
      e.proc.resume();
    }
  }

  private scheduleFlush(): void {
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    for (const [tabId, e] of this.entries) {
      if (!e.pending) continue;
      if (!e.attached) {
        e.pending = '';
        continue;
      }
      const data = e.pending;
      e.pending = '';
      e.unacked += data.length;
      this.updatePause(e);
      this.sink.data(tabId, data);
    }
  }
}

/** A sane terminal dimension from the renderer, which is not trusted: finite, whole, at least `min`. */
function size(v: number, fallback: number, min: number): number {
  return Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback;
}

/**
 * The replay to send: at most REPLAY_LIMIT characters, starting at a line
 * break when there is one near the start, so it doesn't begin halfway through
 * an escape sequence or a character.
 */
function replayFrom(replay: string): string {
  if (replay.length <= REPLAY_LIMIT) return replay;
  const tail = replay.slice(-REPLAY_LIMIT);
  const nl = tail.indexOf('\n');
  return nl >= 0 && nl < 4096 ? tail.slice(nl + 1) : tail;
}

/** A process, or a whole process group (a job), to force-kill. */
type KillTarget = { pid: number } | { pgid: number };

/** pid -> its process group and the terminal's foreground group, for the given pids (or all). */
function processGroups(pids?: number[]): Map<number, { pgid: number; tpgid: number }> | undefined {
  const args = pids ? ['-o', 'pid=,pgid=,tpgid=', '-p', pids.join(',')] : ['-axo', 'pid=,pgid=,tpgid='];
  let out: string;
  try {
    out = execFileSync('/bin/ps', args, { timeout: 2000, maxBuffer: 8 * 1024 * 1024 }).toString();
  } catch {
    return undefined;
  }
  const groups = new Map<number, { pgid: number; tpgid: number }>();
  for (const line of out.split('\n')) {
    const [pid, pgid, tpgid] = line.trim().split(/\s+/).map(Number);
    if (pid && pgid !== undefined && tpgid !== undefined) groups.set(pid, { pgid, tpgid });
  }
  return groups;
}

function running(t: KillTarget): boolean {
  try {
    process.kill('pid' in t ? t.pid : -t.pgid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKill(targets: KillTarget[]): void {
  for (const t of targets) {
    if (!running(t)) continue;
    try {
      process.kill('pid' in t ? t.pid : -t.pgid, 'SIGKILL');
    } catch {
      // exited meanwhile
    }
  }
}
