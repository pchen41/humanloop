import { describe, expect, it } from 'vitest';
import type { TaskAgentState } from '../src/shared/agents';
import { EMPTY_STATE, type AppState, type Priority, type Queue } from '../src/shared/model';
import * as Q from '../src/shared/queues';
import * as T from '../src/shared/tasks';

type Spec = [id: string, priority: Priority, enteredAt: number, queue?: Queue];

function withTasks(...specs: Spec[]): AppState {
  return specs.reduce((s, [id, priority, at, queue]) => {
    const next = T.createTask(s, { title: id, description: '', priority }, id, at);
    return queue && queue !== 'yourTurn'
      ? { ...next, tasks: next.tasks.map((t) => (t.id === id ? { ...t, queue } : t)) }
      : next;
  }, EMPTY_STATE);
}

/** Agent state by task id; anything unlisted has no Claude tabs. */
const agents =
  (m: Record<string, TaskAgentState>): Q.AgentStateOf =>
  (task) =>
    m[task.id] ?? 'none';

const ids = (s: AppState, q: Queue) => T.tasksInQueue(s, q).map((t) => t.id);
const open = (s: AppState, id: string, at = 0) => T.openTask(s, id, at);

describe('reconcile (automatic moves)', () => {
  it('moves working tasks to Agent’s Turn and back when they stop', () => {
    let s = withTasks(['a', 2, 1], ['b', 2, 2]);
    s = Q.reconcile(s, agents({ a: 'working' }), 10);
    expect(ids(s, 'agentsTurn')).toEqual(['a']);
    expect(T.findTask(s, 'a')?.enteredAt).toBe(10);
    for (const st of ['idle', 'needsYou', 'none'] as const) {
      const back = Q.reconcile(s, agents({ a: st }), 20);
      expect(ids(back, 'yourTurn')).toEqual(['b', 'a']); // joins the back of its priority level
      expect(T.findTask(back, 'a')?.enteredAt).toBe(20);
    }
  });

  it('moves the open task too, and keeps it open', () => {
    const s = Q.reconcile(open(withTasks(['a', 2, 1]), 'a'), agents({ a: 'working' }), 10);
    expect(s.openTaskId).toBe('a');
    expect(T.findTask(s, 'a')?.queue).toBe('agentsTurn');
  });

  it('never moves Parked or Done tasks', () => {
    const s = withTasks(['p', 2, 1, 'parked'], ['d', 2, 2, 'done'], ['w', 2, 3, 'agentsTurn']);
    const next = Q.reconcile(s, agents({ p: 'working', d: 'working', w: 'working' }), 10);
    expect(next).toBe(s);
  });

  it('returns the same state when nothing moves', () => {
    const s = withTasks(['a', 2, 1], ['b', 2, 2, 'agentsTurn']);
    expect(Q.reconcile(s, agents({ a: 'idle', b: 'working' }), 10)).toBe(s);
  });
});

describe('nextTask', () => {
  it('files an idle open task to the back of Your Turn and opens the head', () => {
    const s = open(withTasks(['a', 2, 1], ['b', 2, 2], ['c', 2, 3]), 'a');
    const r = Q.nextTask(s, agents({}), 10);
    expect(r.nothingElse).toBe(false);
    expect(r.state.openTaskId).toBe('b');
    expect(ids(r.state, 'yourTurn')).toEqual(['b', 'c', 'a']);
  });

  it('cycles through Your Turn without skipping anything', () => {
    let s = open(withTasks(['a', 2, 1], ['b', 2, 2], ['c', 2, 3]), 'a');
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      s = Q.nextTask(s, agents({}), 10 + i).state;
      seen.push(s.openTaskId!);
    }
    expect(seen).toEqual(['b', 'c', 'a', 'b', 'c', 'a']);
  });

  it('respects priority: a P1 that just came back beats an older P2', () => {
    const s = open(withTasks(['a', 2, 1], ['old', 2, 2], ['urgent', 1, 50]), 'a');
    expect(Q.nextTask(s, agents({}), 100).state.openTaskId).toBe('urgent');
  });

  it('files a needs-you task to Your Turn and a working one to Agent’s Turn', () => {
    const s = open(withTasks(['a', 2, 1], ['b', 2, 2]), 'a');
    expect(ids(Q.nextTask(s, agents({ a: 'needsYou' }), 10).state, 'yourTurn')).toEqual(['b', 'a']);
    const r = Q.nextTask(s, agents({ a: 'working' }), 10);
    expect(ids(r.state, 'agentsTurn')).toEqual(['a']);
    expect(r.state.openTaskId).toBe('b');
  });

  it('leaves a Parked or Done open task where it is', () => {
    const s = open(withTasks(['p', 2, 1, 'parked'], ['b', 2, 2]), 'p');
    const r = Q.nextTask(s, agents({ p: 'idle' }), 10);
    expect(r.state.openTaskId).toBe('b');
    expect(T.findTask(r.state, 'p')).toMatchObject({ queue: 'parked', enteredAt: 1 });
  });

  it('stays put when nothing else needs you', () => {
    const s = open(withTasks(['a', 2, 1], ['w', 2, 2, 'agentsTurn']), 'a');
    const r = Q.nextTask(s, agents({ w: 'working' }), 10);
    expect(r).toEqual({ state: s, nothingElse: true });
    expect(Q.nextTask(EMPTY_STATE, agents({}), 10).nothingElse).toBe(true);
  });

  it('opens the head of Your Turn when nothing is open', () => {
    const r = Q.nextTask(withTasks(['a', 2, 1], ['b', 2, 2]), agents({}), 10);
    expect(r.state.openTaskId).toBe('a');
    expect(T.findTask(r.state, 'a')?.enteredAt).toBe(1); // nothing was filed
  });

  it('records the opened task in history', () => {
    const s = open(withTasks(['a', 2, 1], ['b', 2, 2]), 'a');
    expect(Q.nextTask(s, agents({}), 10).state.history.map((h) => h.taskId)).toEqual(['a', 'b']);
  });
});

describe('park, done and restore', () => {
  it('parks and marks done from any queue, resetting enteredAt', () => {
    const s = withTasks(['a', 2, 1], ['w', 2, 2, 'agentsTurn']);
    expect(T.findTask(Q.parkTask(s, 'w', 10), 'w')).toMatchObject({ queue: 'parked', enteredAt: 10 });
    expect(T.findTask(Q.markDone(s, 'a', 10), 'a')).toMatchObject({ queue: 'done', enteredAt: 10 });
  });

  it('files an unparked or reopened task by its agent state', () => {
    const s = withTasks(['a', 2, 1], ['p', 2, 2, 'parked'], ['d', 2, 3, 'done']);
    expect(T.findTask(Q.restoreTask(s, 'p', agents({ p: 'working' }), 10), 'p')?.queue).toBe('agentsTurn');
    const r = Q.restoreTask(s, 'd', agents({ d: 'idle' }), 10);
    expect(ids(r, 'yourTurn')).toEqual(['a', 'd']);
    expect(Q.restoreTask(s, 'a', agents({ a: 'working' }), 10)).toBe(s);
  });

  it('keeps a parked task open', () => {
    const s = open(withTasks(['a', 2, 1], ['b', 2, 2]), 'a');
    expect(Q.parkTask(s, 'a', 10).openTaskId).toBe('a');
  });
});

describe('back and forward', () => {
  const visited = () => {
    let s = withTasks(['a', 2, 1], ['b', 2, 2], ['c', 2, 3]);
    for (const id of ['a', 'b', 'c']) s = open(s, id);
    return s;
  };

  it('steps through history without moving tasks', () => {
    let s = visited();
    expect(Q.canGoForward(s)).toBe(false);
    s = Q.goBack(s);
    expect(s.openTaskId).toBe('b');
    s = Q.goBack(s);
    expect(s.openTaskId).toBe('a');
    expect(Q.canGoBack(s)).toBe(false);
    expect(Q.goBack(s)).toBe(s);
    s = Q.goForward(s);
    expect(s.openTaskId).toBe('b');
    expect(s.history).toEqual(visited().history);
    expect(s.tasks).toEqual(visited().tasks);
  });

  it('drops forward entries when you open something else', () => {
    let s = Q.goBack(Q.goBack(visited())); // at a
    s = open(s, 'c');
    expect(s.history.map((h) => h.taskId)).toEqual(['a', 'c']);
    expect(Q.canGoForward(s)).toBe(false);
  });

  it('goes back to the previous task after the open one is deleted', () => {
    const s = T.deleteTask(visited(), 'c');
    expect(s.openTaskId).toBeUndefined();
    expect(Q.canGoBack(s)).toBe(true);
    expect(Q.goBack(s).openTaskId).toBe('b');
  });

  it('leaves Parked and Done tasks in history', () => {
    let s = Q.markDone(Q.parkTask(visited(), 'a', 10), 'b', 10);
    s = Q.goBack(Q.goBack(s));
    expect(s.openTaskId).toBe('a');
    expect(T.findTask(s, 'a')?.queue).toBe('parked');
  });
});

describe('review fixes', () => {
  it('keeps Back and Forward right after deleting the first history entry while it was open', () => {
    let s = withTasks(['a', 2, 1], ['b', 2, 2], ['c', 2, 3]);
    for (const id of ['a', 'b', 'c']) s = open(s, id);
    s = T.deleteTask(Q.goBack(Q.goBack(s)), 'a'); // a was open
    expect(s.openTaskId).toBeUndefined();
    expect(Q.canGoBack(s)).toBe(false);
    expect(Q.goForward(s).openTaskId).toBe('b');
    expect(Q.goForward(Q.goForward(s)).openTaskId).toBe('c');
  });

  it('keeps the order of tasks that move at the same moment', () => {
    // b entered Agent's Turn before a; both stop at once.
    const s = withTasks(['a', 2, 20, 'agentsTurn'], ['b', 2, 10, 'agentsTurn']);
    expect(ids(Q.reconcile(s, agents({}), 100), 'yourTurn')).toEqual(['b', 'a']);
  });
});

describe('arrivals', () => {
  it('lists only tasks that came back from Agent’s Turn', () => {
    const prev = withTasks(['w', 2, 1, 'agentsTurn'], ['p', 2, 2, 'agentsTurn'], ['y', 2, 3]);
    let next = Q.reconcile(prev, agents({ p: 'working' }), 10); // w stopped, p still working
    next = Q.parkTask(next, 'y', 10);
    expect(Q.arrivals(prev, next).map((t) => t.id)).toEqual(['w']);
    expect(Q.arrivals(next, next)).toEqual([]);
  });
});
