// Commands run at a tab's prompt, from the marks Humanloop's zsh integration
// prints as each command starts and as the next prompt appears. A command
// that is still running after a few seconds counts as the agent's turn, so
// quick ones (ls, git status) never move the task.

/** How long a command runs before it counts. */
export const COMMAND_DELAY_MS = 5000;

/** OSC 6973, private to Humanloop: "C" as a command starts, "D" at each prompt. */
const MARKS = { start: '\x1b]6973;C\x07', end: '\x1b]6973;D\x07' } as const;
const MARK_RE = /\x1b\]6973;([CD])\x07/g;
const MARK_LEN = MARKS.start.length;

export type CommandMark = 'start' | 'end';

/**
 * Finds command marks in a tab's output. A mark can be split across two
 * chunks, so the start of one at the very end is carried to the next.
 */
export function scanMarks(carry: string, data: string): { marks: CommandMark[]; carry: string } {
  const text = carry + data;
  const marks: CommandMark[] = [];
  if (text.includes('\x1b]6973;')) {
    for (const m of text.matchAll(MARK_RE)) marks.push(m[1] === 'C' ? 'start' : 'end');
  }
  const esc = text.lastIndexOf('\x1b');
  const tail = esc >= 0 && text.length - esc < MARK_LEN ? text.slice(esc) : '';
  const partial = tail && (MARKS.start.startsWith(tail) || MARKS.end.startsWith(tail));
  return { marks, carry: partial ? tail : '' };
}

export class CommandTracker {
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Set<string>();
  /** Tabs whose current command is Claude itself, which reports through its hooks instead. */
  private ignored = new Set<string>();

  /** `finished` is true when a counted command ended at the prompt, false when it stopped counting otherwise. */
  constructor(
    private onChange: (tabId: string, finished: boolean) => void,
    private delayMs = COMMAND_DELAY_MS,
  ) {}

  mark(tabId: string, mark: CommandMark): void {
    if (mark === 'start') this.start(tabId);
    else this.stop(tabId, true);
  }

  private start(tabId: string): void {
    // A start while one is counted means its end mark was missed; it keeps counting.
    if (this.running.has(tabId) || this.timers.has(tabId) || this.ignored.has(tabId)) return;
    this.timers.set(
      tabId,
      setTimeout(() => {
        this.timers.delete(tabId);
        this.running.add(tabId);
        this.onChange(tabId, false);
      }, this.delayMs),
    );
  }

  private stop(tabId: string, finished: boolean): void {
    this.ignored.delete(tabId);
    clearTimeout(this.timers.get(tabId));
    this.timers.delete(tabId);
    if (this.running.delete(tabId)) this.onChange(tabId, finished);
  }

  /**
   * Claude is running in the tab: the command that started it isn't counted,
   * up to the next prompt. (Otherwise, as Claude exits, the moment between
   * its last hook and the prompt would count as a command still running.)
   */
  ignoreCurrent(tabId: string): void {
    if (!this.timers.has(tabId) && !this.running.has(tabId)) return;
    clearTimeout(this.timers.get(tabId));
    this.timers.delete(tabId);
    this.ignored.add(tabId);
    if (this.running.delete(tabId)) this.onChange(tabId, false);
  }

  /** The tab closed, its shell exited, or tracking was turned off. */
  clear(tabId: string): void {
    this.stop(tabId, false);
  }

  clearAll(): void {
    this.ignored.clear();
    for (const id of new Set([...this.timers.keys(), ...this.running])) this.clear(id);
  }

  /** Tabs whose command has run long enough to count. */
  snapshot(): ReadonlySet<string> {
    return new Set(this.running);
  }
}
