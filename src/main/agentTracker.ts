// Turns hook deliveries into each tab's agent state. Drops events from
// `claude -p` processes that Claude itself started inside a tab: they inherit
// the tab's variables, but their parent is not the tab's shell.

import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { applyHookEvent, applyInterrupt, type TabAgent } from '../shared/agents';
import type { HookDelivery } from './hookServer';

/** pid -> parent pid for every process, or undefined if ps failed. */
function processTable(): Promise<Map<number, number> | undefined> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-axo', 'pid=,ppid='], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(undefined);
      const table = new Map<number, number>();
      for (const line of stdout.split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (pid && ppid !== undefined && Number.isInteger(ppid)) table.set(pid, ppid);
      }
      resolve(table);
    });
  });
}

/** How far up the process tree to look for the tab's shell (wrappers like direnv or mise add a level or two). */
const MAX_HOPS = 8;

export interface AgentTrackerOptions {
  /** The pid of the tab's shell, or undefined if the tab has no running shell. */
  shellPid(tabId: string): number | undefined;
  onChange(): void;
  /**
   * The tab's Claude session started, changed (/clear, /resume) or ended
   * (SessionEnd: undefined). Saved so the session can be resumed after a restart.
   */
  onSession?(tabId: string, session: { id: string; cwd: string } | undefined): void;
  /** When set, every delivery is appended here as a JSON line (for checking hook behaviour). */
  logFile?: string;
  /** pid -> parent pid for every process. Defaults to running ps; tests pass their own. */
  processTable?: () => Promise<Map<number, number> | undefined>;
}

export class AgentTracker {
  private agents = new Map<string, TabAgent>();
  /** claude pid -> whether it belongs to that shell. Only definite answers are cached. */
  private verdicts = new Map<number, { shell: number; ok: boolean }>();
  /** claude processes whose events were accepted. A process below one of them is a nested `claude -p`. */
  private claudePids = new Set<number>();
  /** The claude pids accepted for each tab, forgotten when the tab's shell goes (pids get reused). */
  private tabPids = new Map<string, Set<number>>();
  /** Bumped by clear(), so work started before a tab closed or restarted is dropped. */
  private generations = new Map<string, number>();
  /** Per-tab queue, so events apply in the order they arrived despite the async process lookup. */
  private queues = new Map<string, Promise<void>>();

  constructor(private opts: AgentTrackerOptions) {}

  snapshot(): Record<string, TabAgent> {
    return Object.fromEntries(this.agents);
  }

  handle(d: HookDelivery): void {
    // The tab's generation when the event arrived: if the tab closes or its
    // shell restarts while the event waits its turn, it is dropped.
    const gen = this.generations.get(d.tabId) ?? 0;
    this.enqueue(d.tabId, () => this.apply(d, gen));
  }

  /** Esc was pressed in the tab. Queued behind any hook events already received for it. */
  interrupt(tabId: string): void {
    this.enqueue(tabId, async () => {
      const before = this.agents.get(tabId);
      const after = applyInterrupt(before);
      if (after === before || !after) return;
      this.agents.set(tabId, after);
      this.opts.onChange();
    });
  }

  /** The tab's shell exited, restarted or was closed: whatever ran in it is gone. */
  clear(tabId: string): void {
    this.generations.set(tabId, (this.generations.get(tabId) ?? 0) + 1);
    for (const pid of this.tabPids.get(tabId) ?? []) this.forgetPid(pid);
    this.tabPids.delete(tabId);
    if (this.agents.delete(tabId)) this.opts.onChange();
  }

  private forgetPid(pid: number): void {
    this.claudePids.delete(pid);
    this.verdicts.delete(pid);
  }

  /** The process table, trying twice: a missed lookup would drop the event (a missed Stop leaves a tab working). */
  private async table(): Promise<Map<number, number> | undefined> {
    const read = this.opts.processTable ?? processTable;
    return (await read()) ?? (await read());
  }

  private enqueue(tabId: string, fn: () => Promise<void>): void {
    const prev = this.queues.get(tabId) ?? Promise.resolve();
    const next = prev.then(fn).catch((err) => console.error('agent update failed:', err));
    this.queues.set(tabId, next);
    void next.then(() => {
      if (this.queues.get(tabId) === next) this.queues.delete(tabId);
    });
  }

  /**
   * Whether `pid` (the claude process that ran the hook) runs in the tab whose
   * shell is `shell`: the shell must be an ancestor, with no other known
   * claude process in between. Undefined if the process table was unreadable.
   */
  private async belongs(pid: number, shell: number): Promise<boolean | undefined> {
    const cached = this.verdicts.get(pid);
    if (cached && cached.shell === shell) return cached.ok;
    // `exec claude` replaces the shell, so the claude process is the shell itself.
    if (pid === shell) return true;
    const table = await this.table();
    if (!table) return undefined;
    if (!table.has(pid)) return undefined; // already exited; don't cache
    let ok = false;
    let cur = table.get(pid);
    for (let hop = 0; cur !== undefined && cur > 1 && hop < MAX_HOPS; hop++) {
      if (cur === shell) {
        ok = true;
        break;
      }
      if (this.claudePids.has(cur)) break; // nested inside another Claude session
      cur = table.get(cur);
    }
    if (this.verdicts.size > 1024) this.verdicts.clear();
    this.verdicts.set(pid, { shell, ok });
    return ok;
  }

  private async apply(d: HookDelivery, gen: number): Promise<void> {
    const shell = this.opts.shellPid(d.tabId);
    const ok = shell !== undefined && d.pid !== undefined ? await this.belongs(d.pid, shell) : false;
    // The tab may have closed or restarted while we looked.
    const current = (this.generations.get(d.tabId) ?? 0) === gen && this.opts.shellPid(d.tabId) === shell;
    const accepted = ok === true && current;
    if (this.opts.logFile) void this.log(d, shell, accepted);
    if (!accepted) return;

    const pids = this.tabPids.get(d.tabId) ?? new Set<number>();
    this.tabPids.set(d.tabId, pids);
    if (d.event.hook_event_name === 'SessionEnd') {
      pids.delete(d.pid!);
      this.forgetPid(d.pid!);
    } else {
      pids.add(d.pid!);
      this.claudePids.add(d.pid!);
    }
    const before = this.agents.get(d.tabId);
    const after = applyHookEvent(before, d.event);
    if (after === before) return;
    if (after) this.agents.set(d.tabId, after);
    else this.agents.delete(d.tabId);
    if (after?.sessionId !== before?.sessionId || after?.cwd !== before?.cwd) {
      this.opts.onSession?.(d.tabId, after && { id: after.sessionId, cwd: after.cwd ?? '' });
    }
    this.opts.onChange();
  }

  private async log(d: HookDelivery, shell: number | undefined, accepted: boolean) {
    const e = d.event;
    const line = {
      t: new Date().toISOString(),
      tab: d.tabId,
      pid: d.pid,
      shell,
      accepted,
      event: e.hook_event_name,
      session: e.session_id,
      source: e.source,
      notification: e.notification_type,
      tool: e.tool_name,
      agent: e.agent_id,
      agentType: e.agent_type,
      background: e.background_tasks,
      state: accepted ? applyHookEvent(this.agents.get(d.tabId), e)?.state : undefined,
      raw: JSON.stringify(e).slice(0, 500),
    };
    try {
      await appendFile(this.opts.logFile!, JSON.stringify(line) + '\n');
    } catch {
      // logging is best effort
    }
  }
}
