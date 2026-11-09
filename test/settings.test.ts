import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, EMPTY_STATE, hasOverrides, patchSettingsJson } from '../src/shared/model';
import { normalizeSettings } from '../src/shared/normalize';
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
    const out = normalizeSettings(patchSettingsJson({}, { policy: { backgroundShellsBusy: true } }));
    expect(out.policy).toEqual({ ...DEFAULT_POLICY, backgroundShellsBusy: true });
    expect(normalizeSettings({ defaultCwd: '   ' }).defaultCwd).toBeUndefined();
  });
});

describe('per-task overrides', () => {
  it('saves only valid override fields from a draft', () => {
    let s = T.createTask(EMPTY_STATE, { title: 'a', description: '', priority: 5, policy: { backgroundShellsBusy: true } }, 'a', 1);
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
      interrupted: false,
      backgroundTasks: [{ id: 'b', type: 'shell', status: 'running' }],
    };
    let s = T.createTask(EMPTY_STATE, { title: 'dev', description: '', priority: 5 }, 'dev', 1);
    s = T.addTab(s, 'dev', { id: 't', title: 'zsh' });
    const agents = { t: shell };
    // By default background shells are ignored, so the task is your turn.
    expect(Q.reconcile(s, Q.agentStateOf(agents, DEFAULT_POLICY), 10)).toBe(s);
    // This task counts them as busy.
    s = T.updateTask(s, 'dev', { policy: { backgroundShellsBusy: true } });
    expect(T.findTask(Q.reconcile(s, Q.agentStateOf(agents, DEFAULT_POLICY), 10), 'dev')?.queue).toBe('agentsTurn');
  });
});

describe('notifications and keep-awake settings', () => {
  it('default to notifications on and keep-awake off, and take booleans only', () => {
    expect(normalizeSettings({})).toMatchObject({ notifications: true, keepAwake: false });
    expect(normalizeSettings({ notifications: false, keepAwake: 'yes' })).toMatchObject({ notifications: false, keepAwake: false });
    expect(patchSettingsJson({}, { keepAwake: true, notifications: 'no' as never })).toEqual({ keepAwake: true });
  });
});
