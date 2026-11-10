import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, EMPTY_STATE, hasOverrides, patchSettingsJson } from '../src/shared/model';
import { normalizeSettings, normalizeState } from '../src/shared/normalize';
import * as Q from '../src/shared/queues';
import * as T from '../src/shared/tasks';
import type { TabAgent } from '../src/shared/agents';

describe('patchSettingsJson', () => {
  it('changes only the fields the patch names and keeps the rest of the file', () => {
    const disk = { policy: { subagentsBusy: false }, defaultCwd: '/hand/edited', shortcuts: { nextTask: 'Cmd+J' }, extra: 1 };
    const out = patchSettingsJson(disk, { policy: { multiAgent: 'all' } });
    expect(out).toEqual({ ...disk, policy: { subagentsBusy: false, multiAgent: 'all' } });
  });

  it('ignores invalid values', () => {
    const disk = { policy: { multiAgent: 'any' } };
    expect(patchSettingsJson(disk, { policy: { subagentsBusy: 'yes' as never } })).toEqual(disk);
    expect(patchSettingsJson(disk, { defaultCwd: 42 as never })).toEqual(disk);
    expect(patchSettingsJson({}, { policy: [] as never })).toEqual({});
  });

  it('sets, trims and clears the default directory', () => {
    const set = patchSettingsJson({}, { defaultCwd: ' ~/code ' });
    expect(set.defaultCwd).toBe('~/code');
    expect(patchSettingsJson(set, { defaultCwd: null }).defaultCwd).toBeUndefined();
    expect(patchSettingsJson(set, { defaultCwd: '  ' }).defaultCwd).toBeUndefined();
    expect(patchSettingsJson(set, {}).defaultCwd).toBe('~/code');
  });

  it('reads back through normalizeSettings', () => {
    const out = normalizeSettings(patchSettingsJson({}, { policy: { backgroundShellsBusy: false } }));
    expect(out.policy).toEqual({ ...DEFAULT_POLICY, backgroundShellsBusy: false });
    expect(normalizeSettings({ defaultCwd: '   ' }).defaultCwd).toBeUndefined();
  });
});

describe('per-task overrides', () => {
  it('saves only valid override fields from a draft', () => {
    let s = T.createTask(EMPTY_STATE, { title: 'a', description: '', priority: 2, policy: { backgroundShellsBusy: true } }, 'a', 1);
    expect(T.findTask(s, 'a')?.policy).toEqual({ backgroundShellsBusy: true });
    expect(hasOverrides(T.findTask(s, 'a')!)).toBe(true);
    s = T.updateTask(s, 'a', { policy: { multiAgent: 'most' as never } });
    expect(T.findTask(s, 'a')?.policy).toEqual({});
    expect(hasOverrides(T.findTask(s, 'a')!)).toBe(false);
    // Leaving policy out of an edit keeps the overrides.
    s = T.updateTask(T.updateTask(s, 'a', { policy: { subagentsBusy: false } }), 'a', { title: 'b' });
    expect(T.findTask(s, 'a')?.policy).toEqual({ subagentsBusy: false });
  });

  it('files a task by its own policy', () => {
    const shell: TabAgent = {
      sessionId: 's',
      state: 'idle',
      turn: 'idle',
      waitingOn: [],
      started: [],
      interrupted: false,
      backgroundTasks: [{ id: 'b', type: 'shell', status: 'running' }],
    };
    let s = T.createTask(EMPTY_STATE, { title: 'dev', description: '', priority: 2 }, 'dev', 1);
    s = T.addTab(s, 'dev', { id: 't', title: 'zsh' });
    const agents = { t: shell };
    const ignoreShells = { ...DEFAULT_POLICY, backgroundShellsBusy: false };
    // Settings ignore background shells, so the task is your turn.
    expect(Q.reconcile(s, Q.agentStateOf(agents, ignoreShells), 10)).toBe(s);
    // This task counts them as busy.
    s = T.updateTask(s, 'dev', { policy: { backgroundShellsBusy: true } });
    expect(T.findTask(Q.reconcile(s, Q.agentStateOf(agents, ignoreShells), 10), 'dev')?.queue).toBe('agentsTurn');
    // A tab's own rule beats the task's.
    s = T.updateTab(s, 't', { policy: { backgroundShellsBusy: false } });
    expect(Q.reconcile(s, Q.agentStateOf(agents, ignoreShells), 10)).toBe(s);
  });

  it('leaves muted tabs out, and counts running commands', () => {
    const working: TabAgent = {
      sessionId: 's',
      state: 'working',
      turn: 'working',
      waitingOn: [],
      started: [],
      interrupted: false,
      backgroundTasks: [],
    };
    let s = T.createTask(EMPTY_STATE, { title: 'a', description: '', priority: 2 }, 'a', 1);
    s = T.addTab(s, 'a', { id: 't', title: 'zsh' });
    s = T.addTab(s, 'a', { id: 'u', title: 'zsh' });
    const waitForCommands = { ...DEFAULT_POLICY, commandsBusy: true };
    const filed = (st: typeof s, running = new Set<string>(), policy = waitForCommands) =>
      T.findTask(Q.reconcile(st, Q.agentStateOf({ t: working }, policy, running), 10), 'a')?.queue;
    expect(filed(s)).toBe('agentsTurn');
    s = T.updateTab(s, 't', { muted: true });
    expect(filed(s)).toBe('yourTurn');
    expect(filed(s, new Set(['u']))).toBe('agentsTurn');
    // Commands count only where the rules wait for them: globally, or for this tab.
    const ignoreCommands = { ...DEFAULT_POLICY, commandsBusy: false };
    expect(filed(s, new Set(['u']), ignoreCommands)).toBe('yourTurn');
    s = T.updateTab(s, 'u', { policy: { commandsBusy: true } });
    expect(filed(s, new Set(['u']), ignoreCommands)).toBe('agentsTurn');
  });
});

describe('tabs from disk', () => {
  it('keep mute and their own rules, dropping invalid ones', () => {
    const s = normalizeState({
      tasks: [
        {
          id: 'a',
          tabs: [
            { id: 't', muted: true, policy: { subagentsBusy: false, multiAgent: 'all', backgroundShellsBusy: 'x' } },
            { id: 'u', muted: 'yes', policy: {} },
          ],
        },
      ],
    });
    expect(s.tasks[0]!.tabs).toEqual([
      { id: 't', title: 'zsh', muted: true, policy: { subagentsBusy: false } },
      { id: 'u', title: 'zsh' },
    ]);
  });

  it('move within their task', () => {
    let s = T.createTask(EMPTY_STATE, { title: 'a', description: '', priority: 2 }, 'a', 1);
    for (const id of ['1', '2', '3']) s = T.addTab(s, 'a', { id, title: id });
    const order = (st: typeof s) => T.findTask(st, 'a')!.tabs.map((t) => t.id);
    expect(order(T.moveTab(s, '1', 2))).toEqual(['2', '3', '1']);
    expect(order(T.moveTab(s, '3', 0))).toEqual(['3', '1', '2']);
    expect(order(T.moveTab(s, '2', 99))).toEqual(['1', '3', '2']);
    expect(T.moveTab(s, '2', 1)).toBe(s);
  });
});

describe('notifications and keep-awake settings', () => {
  it('default to notifications on and keep-awake off, and take booleans only', () => {
    expect(normalizeSettings({})).toMatchObject({ notifications: true, keepAwake: false });
    expect(normalizeSettings({ notifications: false, keepAwake: 'yes' })).toMatchObject({ notifications: false, keepAwake: false });
    expect(patchSettingsJson({}, { keepAwake: true, notifications: 'no' as never })).toEqual({ keepAwake: true });
    expect(normalizeSettings({}).newTabsInCurrentDir).toBe(true);
    expect(normalizeSettings({ newTabsInCurrentDir: false }).newTabsInCurrentDir).toBe(false);
    expect(normalizeSettings({ newTabsInCurrentDir: 0 }).newTabsInCurrentDir).toBe(true);
    expect(patchSettingsJson({ a: 1 }, { newTabsInCurrentDir: false })).toEqual({ a: 1, newTabsInCurrentDir: false });
    expect(normalizeSettings({}).policy.commandsBusy).toBe(true);
    expect(normalizeSettings({ policy: { commandsBusy: false } }).policy.commandsBusy).toBe(false);
  });
});
