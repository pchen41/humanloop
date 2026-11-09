import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, type AppState, type Priority } from '../src/shared/model';
import { normalizeSettings, normalizeState, stateAfterLaunch } from '../src/shared/normalize';
import * as T from '../src/shared/tasks';

function withTasks(...specs: [id: string, priority: Priority, enteredAt: number][]): AppState {
  return specs.reduce(
    (s, [id, priority, at]) => T.createTask(s, { title: id, description: '', priority }, id, at),
    EMPTY_STATE,
  );
}

describe('queue order', () => {
  it('sorts by priority, then by time entered', () => {
    const s = withTasks(['late-p1', 1, 300], ['p2', 2, 100], ['early-p1', 1, 200], ['p0', 0, 400]);
    expect(T.tasksInQueue(s, 'yourTurn').map((t) => t.id)).toEqual(['p0', 'early-p1', 'late-p1', 'p2']);
  });

  it('keeps enteredAt when priority changes', () => {
    const s = T.updateTask(withTasks(['a', 2, 100]), 'a', { priority: 1 });
    expect(T.findTask(s, 'a')).toMatchObject({ priority: 1, enteredAt: 100 });
  });

  it('resets enteredAt when a task changes queue', () => {
    const s = T.moveTask(withTasks(['a', 2, 100]), 'a', 'parked', 500);
    expect(T.findTask(s, 'a')).toMatchObject({ queue: 'parked', enteredAt: 500 });
  });
});

describe('createTask / updateTask', () => {
  it('trims fields and fills an empty title', () => {
    const s = T.createTask(EMPTY_STATE, { title: '  ', description: ' notes ', priority: 3, defaultCwd: ' ' }, 'x', 1);
    expect(T.findTask(s, 'x')).toMatchObject({ title: 'Untitled task', description: 'notes', queue: 'yourTurn' });
    expect(T.findTask(s, 'x')?.defaultCwd).toBeUndefined();
  });
});

describe('history', () => {
  it('records opens, skips repeats and drops forward entries', () => {
    let s = withTasks(['a', 2, 1], ['b', 2, 2], ['c', 2, 3]);
    s = T.openTask(s, 'a', 10);
    s = T.openTask(s, 'b', 11);
    s = T.openTask(s, 'b', 12);
    expect(s.history.map((h) => h.taskId)).toEqual(['a', 'b']);
    s = { ...s, historyIndex: 0, openTaskId: 'a' }; // as if the user went back
    s = T.openTask(s, 'c', 13);
    expect(s.history.map((h) => h.taskId)).toEqual(['a', 'c']);
    expect(s.historyIndex).toBe(1);
  });

  it('caps history at the limit', () => {
    let s = withTasks(['a', 2, 1], ['b', 2, 2]);
    for (let i = 0; i < T.HISTORY_LIMIT + 20; i++) s = T.openTask(s, i % 2 ? 'b' : 'a', i);
    expect(s.history).toHaveLength(T.HISTORY_LIMIT);
    expect(s.historyIndex).toBe(T.HISTORY_LIMIT - 1);
  });

  it('removes a deleted task from history and merges the neighbours it leaves behind', () => {
    let s = withTasks(['a', 2, 1], ['b', 2, 2], ['c', 2, 3]);
    for (const id of ['a', 'b', 'c', 'b']) s = T.openTask(s, id, 0);
    s = T.deleteTask(s, 'c');
    expect(s.history.map((h) => h.taskId)).toEqual(['a', 'b']);
    expect(s.historyIndex).toBe(1);
    expect(s.openTaskId).toBe('b');
    expect(s.tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('clears the open task when it is deleted', () => {
    let s = T.openTask(withTasks(['a', 2, 1]), 'a', 0);
    s = T.deleteTask(s, 'a');
    expect(s).toMatchObject({ openTaskId: undefined, history: [], historyIndex: -1 });
  });
});

describe('tabs', () => {
  it('adds, renames and closes tabs', () => {
    let s = withTasks(['a', 2, 1]);
    s = T.addTab(s, 'a', { id: 't1', title: 'zsh' });
    s = T.addTab(s, 'a', { id: 't2', title: 'zsh' });
    s = T.updateTab(s, 't2', { title: 'claude' });
    expect(T.findTab(s, 't2')?.tab.title).toBe('claude');
    s = T.closeTab(s, 'a', 't1');
    expect(T.findTask(s, 'a')?.tabs.map((t) => t.id)).toEqual(['t2']);
  });
});

describe('normalize', () => {
  it('drops malformed tasks and history that points at missing tasks', () => {
    const s = normalizeState({
      tasks: [
        { id: 'a', title: 'A', priority: 42, queue: 'bogus', tabs: [{ id: 't' }, { nope: 1 }] },
        { title: 'no id' },
        { id: 'a', title: 'duplicate' },
      ],
      history: [{ taskId: 'a', openedAt: 1 }, { taskId: 'gone', openedAt: 2 }],
      historyIndex: 7,
      openTaskId: 'gone',
    });
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ id: 'a', priority: 2, queue: 'yourTurn', tabs: [{ id: 't', title: 'zsh' }] });
    expect(s.history).toEqual([{ taskId: 'a', openedAt: 1 }]);
    expect(s.historyIndex).toBe(0);
    expect(s.openTaskId).toBeUndefined();
  });

  it("moves Agent's Turn tasks to Your Turn on launch, keeping their order", () => {
    let s = withTasks(['x', 2, 1], ['y', 2, 2], ['z', 2, 3]);
    s = T.moveTask(s, 'y', 'agentsTurn', 20);
    s = T.moveTask(s, 'x', 'agentsTurn', 30);
    s = stateAfterLaunch(s, 1000);
    expect(T.tasksInQueue(s, 'agentsTurn')).toHaveLength(0);
    expect(T.tasksInQueue(s, 'yourTurn').map((t) => t.id)).toEqual(['z', 'y', 'x']);
  });

  it('keeps only known shortcuts and fills policy defaults', () => {
    const settings = normalizeSettings({ shortcuts: { newTab: 'Cmd+Y', bogus: 'X', closeTab: 3 }, policy: { multiAgent: 'all' } });
    expect(settings.shortcuts).toEqual({ newTab: 'Cmd+Y' });
    expect(settings.policy).toEqual({ multiAgent: 'all', subagentsBusy: true, backgroundShellsBusy: false });
  });
});

describe('review fixes', () => {
  it('keeps the history index on the same entry after dropping missing tasks', () => {
    const s = normalizeState({
      tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      history: [
        { taskId: 'a', openedAt: 1 },
        { taskId: 'missing', openedAt: 2 },
        { taskId: 'b', openedAt: 3 },
        { taskId: 'c', openedAt: 4 },
      ],
      historyIndex: 2, // points at b
    });
    expect(s.history.map((h) => h.taskId)).toEqual(['a', 'b', 'c']);
    expect(s.history[s.historyIndex]?.taskId).toBe('b');
  });

  it('merges neighbours left adjacent by a dropped entry', () => {
    const s = normalizeState({
      tasks: [{ id: 'a' }, { id: 'b' }],
      history: [{ taskId: 'a' }, { taskId: 'gone' }, { taskId: 'a' }, { taskId: 'b' }],
      historyIndex: 2,
    });
    expect(s.history.map((h) => h.taskId)).toEqual(['a', 'b']);
    expect(s.historyIndex).toBe(0);
  });

  it('ignores invalid fields in drafts sent over IPC', () => {
    const bad = { title: 'T', description: 'D', priority: 100, queue: 'done', tabs: 'x' } as never;
    let s = T.createTask(EMPTY_STATE, bad, 'a', 1);
    expect(T.findTask(s, 'a')).toMatchObject({ priority: 2, queue: 'yourTurn', tabs: [] });
    s = T.updateTask(s, 'a', { priority: -1, title: 7 } as never);
    expect(T.findTask(s, 'a')).toMatchObject({ priority: 2, title: 'T' });
  });
});

describe('priority scale P0–P3', () => {
  it('maps older P4–P9 priorities onto the new scale', () => {
    const task = (priority: number) => ({ id: `t${priority}`, title: 'T', priority, queue: 'yourTurn', tabs: [] });
    const s = normalizeState({ tasks: [0, 3, 4, 5, 6, 7, 9, 10].map(task), history: [], historyIndex: -1 });
    expect(s.tasks.map((t) => t.priority)).toEqual([0, 3, 2, 2, 2, 3, 3, 2]);
  });

  it('accepts only P0–P3 from the editor', () => {
    const s = T.createTask(EMPTY_STATE, { title: 'a', description: '', priority: 4 as never }, 'a', 1);
    expect(T.findTask(s, 'a')?.priority).toBe(2);
  });
});

describe('review fixes: state from disk', () => {
  it('gives duplicate tab ids their own, so two tabs never share a shell', () => {
    const tab = { id: 't', title: 'zsh', claudeSession: { id: 's', cwd: '/p' } };
    const s = normalizeState({
      tasks: [
        { id: 'a', title: 'A', priority: 2, queue: 'yourTurn', tabs: [tab, tab] },
        { id: 'b', title: 'B', priority: 2, queue: 'yourTurn', tabs: [tab] },
      ],
      history: [],
      historyIndex: -1,
    });
    const ids = s.tasks.flatMap((t) => t.tabs.map((x) => x.id));
    expect(new Set(ids).size).toBe(3);
    expect(s.tasks[0]!.tabs[0]).toEqual(tab);
    expect(s.tasks[1]!.tabs[0]!.claudeSession).toBeUndefined();
  });
});
