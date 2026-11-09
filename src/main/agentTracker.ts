// Turns hook deliveries into each tab's agent state. Drops events from
// `claude -p` processes that Claude itself started inside a tab: they inherit
// the tab's variables, but their parent is not the tab's shell.

import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { applyHookEvent, applyInterrupt, type TabAgent } from '../shared/agents';
import type { HookDelivery } from './hookServer';

function parentPid(pid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: 2000 }, (err, stdout) => {
      const ppid = Number(stdout.trim());
      resolve(!err && Number.isInteger(ppid) && ppid > 0 ? ppid : undefined);
    });
  });
}

export interface AgentTrackerOptions {
  /** The pid of the tab's shell, or undefined if the tab has no running shell. */
  shellPid(tabId: string): number | undefined;
  onChange(): void;
  /** When set, every delivery is appended here as a JSON line (for checking hook behaviour). */
  logFile?: string;
}

export class AgentTracker {
  private agents = new Map<string, TabAgent>();
  /** claude pid -> its parent pid. A process's parent doesn't change while it runs. */
  private parents = new Map<number, number | undefined>();
  /** Per-tab queue, so events apply in the order they arrived despite the async parent lookup. */
  private queues = new Map<string, Promise<void>>();

  constructor(private opts: AgentTrackerOptions) {}

  snapshot(): Record<string, TabAgent> {
    return Object.fromEntries(this.agents);
  }

  get(tabId: string): TabAgent | undefined {
    return this.agents.get(tabId);
  }

  handle(d: HookDelivery): void {
    this.enqueue(d.tabId, () => this.apply(d));
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

  private enqueue(tabId: string, fn: () => Promise<void>): void {
    const prev = this.queues.get(tabId) ?? Promise.resolve();
    const next = prev.then(fn).catch((err) => console.error('agent update failed:', err));
    this.queues.set(tabId, next);
    void next.then(() => {
      if (this.queues.get(tabId) === next) this.queues.delete(tabId);
    });
  }

  /** The tab's shell exited, restarted or was closed: whatever ran in it is gone. */
  clear(tabId: string): void {
    if (this.agents.delete(tabId)) this.opts.onChange();
  }

  private async apply(d: HookDelivery): Promise<void> {
    const shell = this.opts.shellPid(d.tabId);
    let ppid: number | undefined;
    if (d.pid !== undefined) {
      if (!this.parents.has(d.pid)) {
        if (this.parents.size > 512) this.parents.clear();
        this.parents.set(d.pid, await parentPid(d.pid));
      }
      ppid = this.parents.get(d.pid);
    }
    const accepted = shell !== undefined && ppid === shell;
    if (this.opts.logFile) void this.log(d, shell, ppid, accepted);
    if (!accepted) return;

    const before = this.agents.get(d.tabId);
    const after = applyHookEvent(before, d.event);
    if (after === before) return;
    if (after) this.agents.set(d.tabId, after);
    else this.agents.delete(d.tabId);
    if (d.event.hook_event_name === 'SessionEnd' && d.pid !== undefined) this.parents.delete(d.pid);
    this.opts.onChange();
  }

  private async log(d: HookDelivery, shell: number | undefined, ppid: number | undefined, accepted: boolean) {
    const e = d.event;
    const line = {
      t: new Date().toISOString(),
      tab: d.tabId,
      pid: d.pid,
      ppid,
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
