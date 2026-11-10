// Commands run at a tab's prompt, from the marks Humanloop's zsh integration
// prints as each command starts and as the next prompt appears. A command
// that is still running after a few seconds counts as the agent's turn, so
// quick ones (ls, git status) never move the task.

/** How long a command runs before it counts. */
export const COMMAND_DELAY_MS = 5000;

/**
 * OSC 6973, private to Humanloop: "C;<command line>" as a command starts,
 * "D;<exit status>" at each prompt.
 */
const PREFIX = '\x1b]6973;';
const MARK_RE = /\x1b\]6973;([CD])(?:;([^\x07\x1b]*))?\x07/g;
/** The longest mark the shell prints (its command line is cut to 200 characters), with room to spare. */
const MAX_MARK = 1024;

export type CommandMark = { kind: 'start'; command: string } | { kind: 'end'; exit?: number };

import type { CommandInfo } from '../shared/ipc';
export type { CommandInfo };

/**
 * Finds command marks in a tab's output. A mark can be split across two
 * chunks, so the start of one at the very end is carried to the next.
 */
export function scanMarks(carry: string, data: string): { marks: CommandMark[]; carry: string } {
  const text = carry + data;
  const marks: CommandMark[] = [];
  if (text.includes(PREFIX)) {
    for (const m of text.matchAll(MARK_RE)) {
      if (m[1] === 'C') marks.push({ kind: 'start', command: (m[2] ?? '').trim() });
      else {
        const exit = Number(m[2]);
        marks.push({ kind: 'end', exit: m[2] && Number.isInteger(exit) ? exit : undefined });
      }
    }
  }
  const esc = text.lastIndexOf('\x1b');
  const tail = esc >= 0 && text.length - esc < MAX_MARK ? text.slice(esc) : '';
  // The start of a mark not yet finished: its prefix so far, or the prefix and some of its text.
  const partial = tail && !tail.includes('\x07') && (PREFIX.startsWith(tail) || tail.startsWith(PREFIX));
  return { marks, carry: partial ? tail : '' };
}

export class CommandTracker {
  /** Commands under way that haven't run long enough to count yet. */
  private pending = new Map<string, { timer: NodeJS.Timeout; command: string; since: number }>();
  private running = new Map<string, { command: string; since: number }>();
  /** Counted commands that have finished, until you type in their tab. */
  private done = new Map<string, { command: string; exit?: number }>();
  /** Tabs whose current command is Claude itself, which reports through its hooks instead. */
  private ignored = new Set<string>();

  /**
   * `finished` is true when a counted command ended at the prompt, false for
   * any other change. `hasForegroundJob` says whether a program is running in
   * the tab's foreground.
   */
  constructor(
    private onChange: (tabId: string, finished: boolean) => void,
    private hasForegroundJob: (tabId: string) => boolean = () => true,
    private delayMs = COMMAND_DELAY_MS,
  ) {}

  mark(tabId: string, mark: CommandMark): void {
    if (mark.kind === 'start') this.start(tabId, mark.command);
    else this.stop(tabId, true, mark.exit);
  }

  private start(tabId: string, command: string): void {
    if (this.done.delete(tabId)) this.onChange(tabId, false);
    // A start while one is counted means its end mark was missed; it keeps counting.
    if (this.running.has(tabId) || this.pending.has(tabId) || this.ignored.has(tabId)) return;
    const since = Date.now();
    const timer = setTimeout(() => {
      this.pending.delete(tabId);
      // Nothing in the foreground: the shell is back at a prompt without
      // saying so, as after `exec zsh` (the new shell prints no marks).
      // (A loop between two of its commands also looks like this; it isn't counted.)
      if (!this.hasForegroundJob(tabId)) return;
      this.running.set(tabId, { command, since });
      this.onChange(tabId, false);
    }, this.delayMs);
    this.pending.set(tabId, { timer, command, since });
  }

  private stop(tabId: string, finished: boolean, exit?: number): void {
    this.ignored.delete(tabId);
    clearTimeout(this.pending.get(tabId)?.timer);
    this.pending.delete(tabId);
    const counted = this.running.get(tabId);
    if (!counted) return;
    this.running.delete(tabId);
    if (finished) this.done.set(tabId, { command: counted.command, exit });
    this.onChange(tabId, finished);
  }

  /** You typed in the tab: a finished command's ring goes back to the plain shell. */
  typed(tabId: string): void {
    if (this.done.delete(tabId)) this.onChange(tabId, false);
  }

  /**
   * Claude is running in the tab: the command that started it isn't counted,
   * up to the next prompt. (Otherwise, as Claude exits, the moment between
   * its last hook and the prompt would count as a command still running.)
   */
  ignoreCurrent(tabId: string): void {
    if (!this.pending.has(tabId) && !this.running.has(tabId)) return;
    clearTimeout(this.pending.get(tabId)?.timer);
    this.pending.delete(tabId);
    this.ignored.add(tabId);
    if (this.running.delete(tabId)) this.onChange(tabId, false);
  }

  /** The tab closed or its shell exited. */
  clear(tabId: string): void {
    this.stop(tabId, false);
    if (this.done.delete(tabId)) this.onChange(tabId, false);
  }

  /** Tabs whose command has run long enough to count. */
  snapshot(): ReadonlySet<string> {
    return new Set(this.running.keys());
  }

  /** Each tab's counted command, running or just finished. */
  info(): Record<string, CommandInfo> {
    const out: Record<string, CommandInfo> = {};
    for (const [id, c] of this.done) out[id] = { state: 'done', command: c.command, exit: c.exit };
    for (const [id, c] of this.running) out[id] = { state: 'running', command: c.command, since: c.since };
    return out;
  }
}
