import { describe, expect, it } from 'vitest';
import { AgentTracker } from '../src/main/agentTracker';

/** A tracker over a fake process table: shells by tab, and pid -> parent pid. */
function setup(shells: Record<string, number>, parents: Record<number, number>) {
  let table: Map<number, number> | undefined = new Map(Object.entries(parents).map(([k, v]) => [Number(k), v]));
  let lookups = 0;
  let failNext = 0;
  const tracker = new AgentTracker({
    shellPid: (tab) => shells[tab],
    onChange: () => {},
    processTable: async () => {
      lookups++;
      if (failNext > 0) {
        failNext--;
        return undefined;
      }
      return table;
    },
  });
  const send = (tab: string, pid: number, event: Record<string, unknown>) =>
    tracker.handle({ tabId: tab, pid, event: { session_id: 's', ...event } });
  const settle = () => new Promise((r) => setTimeout(r, 10));
  return {
    tracker,
    send,
    settle,
    lookups: () => lookups,
    failLookups: (n: number) => (failNext = n),
    setTable: (t: Record<number, number> | undefined) =>
      (table = t && new Map(Object.entries(t).map(([k, v]) => [Number(k), v]))),
  };
}

describe('AgentTracker', () => {
  it('accepts claude under the tab shell, through wrappers', async () => {
    const t = setup({ tab: 100 }, { 200: 150, 150: 100 }); // claude 200 -> direnv 150 -> zsh 100
    t.send('tab', 200, { hook_event_name: 'UserPromptSubmit' });
    await t.settle();
    expect(t.tracker.snapshot().tab?.state).toBe('working');
  });

  it('drops a nested claude -p started by an accepted claude', async () => {
    const t = setup({ tab: 100 }, { 200: 100, 300: 250, 250: 200 }); // claude 200 -> bash 250 -> claude -p 300
    t.send('tab', 200, { hook_event_name: 'SessionStart' });
    t.send('tab', 300, { hook_event_name: 'UserPromptSubmit', session_id: 'nested' });
    await t.settle();
    expect(t.tracker.snapshot().tab).toMatchObject({ sessionId: 's', state: 'idle' });
  });

  it('drops events from a claude in another tab', async () => {
    const t = setup({ a: 100, b: 500 }, { 200: 500 });
    t.send('a', 200, { hook_event_name: 'UserPromptSubmit' });
    await t.settle();
    expect(t.tracker.snapshot().a).toBeUndefined();
  });

  it('tracks `exec claude`, where claude is the shell process itself', async () => {
    const t = setup({ tab: 100 }, {});
    t.send('tab', 100, { hook_event_name: 'UserPromptSubmit' });
    await t.settle();
    expect(t.tracker.snapshot().tab?.state).toBe('working');
  });

  it('retries a failed process lookup instead of dropping the event', async () => {
    const t = setup({ tab: 100 }, { 200: 100 });
    t.failLookups(1);
    t.send('tab', 200, { hook_event_name: 'UserPromptSubmit' });
    await t.settle();
    expect(t.tracker.snapshot().tab?.state).toBe('working');
  });

  it('applies events and Esc in the order they arrived', async () => {
    const t = setup({ tab: 100 }, { 200: 100 });
    t.send('tab', 200, { hook_event_name: 'UserPromptSubmit' });
    t.tracker.interrupt('tab');
    await t.settle();
    expect(t.tracker.snapshot().tab?.state).toBe('idle');
  });

  it('forgets a closed tab and its claude pids, so a reused pid is judged afresh', async () => {
    const t = setup({ a: 100, b: 500 }, { 200: 100 });
    t.send('a', 200, { hook_event_name: 'UserPromptSubmit' });
    await t.settle();
    t.tracker.clear('a');
    expect(t.tracker.snapshot().a).toBeUndefined();
    // pid 200 is reused for a wrapper under tab b's shell, with a new claude 300 below it.
    t.setTable({ 200: 500, 300: 200 });
    t.send('b', 300, { hook_event_name: 'UserPromptSubmit' });
    await t.settle();
    expect(t.tracker.snapshot().b?.state).toBe('working');
  });

  it('drops events that were in flight when the tab closed', async () => {
    const t = setup({ tab: 100 }, { 200: 100 });
    t.send('tab', 200, { hook_event_name: 'UserPromptSubmit' });
    t.tracker.clear('tab');
    await t.settle();
    expect(t.tracker.snapshot().tab).toBeUndefined();
  });
});

describe('AgentTracker review fixes', () => {
  it('rejects a nested claude -p under an `exec claude` tab', async () => {
    const t = setup({ tab: 100 }, { 300: 250, 250: 100 }); // claude (exec'd, pid 100) -> zsh 250 -> claude -p 300
    t.send('tab', 100, { hook_event_name: 'SessionStart' });
    t.send('tab', 300, { hook_event_name: 'UserPromptSubmit', session_id: 'nested' });
    await t.settle();
    expect(t.tracker.snapshot().tab).toMatchObject({ sessionId: 's', state: 'idle' });
  });

  it('checks a reused pid again when a new session uses it', async () => {
    // pid 300 was a nested claude -p (rejected); it exits and a top-level claude under the shell gets pid 300.
    const t = setup({ tab: 100 }, { 200: 100, 300: 200 });
    t.send('tab', 200, { hook_event_name: 'SessionStart' });
    t.send('tab', 300, { hook_event_name: 'UserPromptSubmit', session_id: 'nested' });
    await t.settle();
    t.send('tab', 200, { hook_event_name: 'SessionEnd' });
    await t.settle();
    t.setTable({ 300: 100 });
    t.send('tab', 300, { hook_event_name: 'UserPromptSubmit', session_id: 'top' });
    await t.settle();
    expect(t.tracker.snapshot().tab).toMatchObject({ sessionId: 'top', state: 'working' });
  });
});

describe('AgentTracker third-round fixes', () => {
  it("accepts a tab whose shell reuses a crashed claude's pid", async () => {
    // Tab a's claude (pid 500) is killed without SessionEnd, so it stays known.
    // After pid wrap-around, tab b's shell is pid 500, and its claude 700 runs under it.
    const t = setup({ a: 100, b: 500 }, { 500: 100 });
    t.send('a', 500, { hook_event_name: 'SessionStart' });
    await t.settle();
    t.setTable({ 700: 500 });
    t.send('b', 700, { hook_event_name: 'UserPromptSubmit', session_id: 'b-session' });
    await t.settle();
    expect(t.tracker.snapshot().b?.state).toBe('working');
  });
});
