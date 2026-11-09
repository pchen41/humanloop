// Owns one zsh process per terminal tab. Output is batched before it goes to
// the renderer, and the shell is paused while the renderer falls behind.

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import * as pty from 'node-pty';

/** Pause the shell when this many characters are sent but not yet drawn. */
const HIGH_WATER = 512 * 1024;
/** Resume once the renderer is back under this. */
const LOW_WATER = 128 * 1024;
/** Output kept per tab so a reloaded renderer can redraw recent history. */
const REPLAY_LIMIT = 256 * 1024;
/** How often batched output is sent to the renderer. */
const FLUSH_MS = 8;

export interface PtySink {
  data(tabId: string, data: string): void;
  exit(tabId: string, exitCode: number): void;
}

interface Entry {
  proc: pty.IPty;
  replay: string;
  pending: string;
  unacked: number;
  paused: boolean;
  /** False while no window is showing this tab's output (closed or reloading). */
  attached: boolean;
  exited?: number;
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
 * markers (CLAUDECODE, CLAUDE_CODE_SESSION_ID, CLAUDE_CODE_CHILD_SESSION, …)
 * would make every `claude` in a tab think it is a child session. Tabs start
 * login shells, so variables you set in your shell profile come back anyway.
 * ANTHROPIC_* settings (gateway URL, keys) are configuration and are kept.
 */
function stripped(name: string): boolean {
  return STRIPPED_ENV.includes(name) || name.startsWith('CLAUDE') || name.startsWith('HUMANLOOP_');
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
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(private sink: PtySink) {}

  has(tabId: string): boolean {
    const e = this.entries.get(tabId);
    return !!e && e.exited === undefined;
  }

  /**
   * Starts the tab's shell if it is not running and returns recent output so
   * the renderer can redraw it. Restarts a shell that has exited.
   */
  attach(tabId: string, opts: SpawnOptions): { replay: string } {
    const existing = this.entries.get(tabId);
    if (existing && existing.exited === undefined) {
      // The replay already contains anything still pending, so drop it to
      // avoid drawing the same output twice.
      existing.pending = '';
      existing.attached = true;
      existing.unacked = 0;
      this.updatePause(existing);
      this.resize(tabId, opts.cols, opts.rows);
      return { replay: existing.replay };
    }
    this.spawn(tabId, opts);
    return { replay: '' };
  }

  private spawn(tabId: string, opts: SpawnOptions): void {
    // A login shell picks up PATH from the user's profile, which matters when
    // the app was opened from Finder with launchd's minimal environment.
    const proc = pty.spawn('/bin/zsh', ['-l'], {
      name: 'xterm-256color',
      cols: Math.max(2, opts.cols),
      rows: Math.max(1, opts.rows),
      cwd: opts.cwd,
      env: opts.env,
    });
    const entry: Entry = { proc, replay: '', pending: '', unacked: 0, paused: false, attached: true };
    this.entries.set(tabId, entry);

    proc.onData((data) => {
      entry.replay += data;
      if (entry.replay.length > REPLAY_LIMIT) entry.replay = entry.replay.slice(-REPLAY_LIMIT);
      entry.pending += data;
      this.scheduleFlush();
    });
    proc.onExit(({ exitCode }) => {
      entry.exited = exitCode;
      this.flush();
      this.sink.exit(tabId, exitCode);
    });
  }

  write(tabId: string, data: string): void {
    const e = this.entries.get(tabId);
    if (e && e.exited === undefined) e.proc.write(data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    const e = this.entries.get(tabId);
    if (!e || e.exited !== undefined) return;
    try {
      e.proc.resize(Math.max(2, cols), Math.max(1, rows));
    } catch {
      // The process can exit between the check and the resize.
    }
  }

  /** The renderer has drawn this many characters. */
  ack(tabId: string, chars: number): void {
    const e = this.entries.get(tabId);
    if (!e) return;
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

  pid(tabId: string): number | undefined {
    return this.entries.get(tabId)?.proc.pid;
  }

  kill(tabId: string): void {
    const e = this.entries.get(tabId);
    this.entries.delete(tabId);
    if (!e || e.exited !== undefined) return;
    try {
      e.proc.kill('SIGHUP');
    } catch {
      // already gone
    }
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
