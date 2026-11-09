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
/** Initial input waits for this long a pause in the shell's startup output... */
const INPUT_QUIET_MS = 150;
/** ...or this long at most. */
const INPUT_FALLBACK_MS = 3000;

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
  exited?: number;
}

export interface SpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  /** Typed into the shell once it starts, e.g. "claude\r". */
  initialInput?: string;
}

/** Variables that must not leak from the app's own environment into tab shells. */
const STRIPPED_ENV = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_RENDERER_URL',
  'NODE_OPTIONS',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
];

export function shellEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || STRIPPED_ENV.includes(k) || k.startsWith('HUMANLOOP_')) continue;
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
      existing.unacked = 0;
      this.updatePause(existing);
      existing.proc.resize(opts.cols, opts.rows);
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
    const entry: Entry = { proc, replay: '', pending: '', unacked: 0, paused: false };
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
    if (opts.initialInput) this.typeWhenReady(entry, opts.initialInput);
  }

  /**
   * Types into the shell once its startup output has gone quiet, so the input
   * lands at the prompt instead of being echoed above it.
   */
  private typeWhenReady(entry: Entry, input: string): void {
    let done = false;
    let quiet: NodeJS.Timeout | undefined;
    const type = () => {
      if (done) return;
      done = true;
      clearTimeout(quiet);
      clearTimeout(fallback);
      sub.dispose();
      if (entry.exited === undefined) entry.proc.write(input);
    };
    const sub = entry.proc.onData(() => {
      clearTimeout(quiet);
      quiet = setTimeout(type, INPUT_QUIET_MS);
    });
    const fallback = setTimeout(type, INPUT_FALLBACK_MS);
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
      const data = e.pending;
      e.pending = '';
      e.unacked += data.length;
      this.updatePause(e);
      this.sink.data(tabId, data);
    }
  }
}
