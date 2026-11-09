// QueueEngine: which queue each task belongs in, and the queue commands
// (Next task, Park, Done, Back, Forward). Pure functions over AppState, so
// they run in unit tests; the main process feeds in each task's agent state.

import { agentFor, taskAgentState, type TabAgent, type TaskAgentState } from './agents';
import { effectivePolicy, type AppState, type Policy, type Queue, type Task } from './model';
import { findTask, moveTask, openTask, tasksInQueue } from './tasks';

/** A task's agent state, from its tabs' Claude sessions and its policy. */
export type AgentStateOf = (task: Task) => TaskAgentState;

/** Reads agent state from the tracker's per-tab snapshot. */
export function agentStateOf(agents: Record<string, TabAgent | undefined>, globalPolicy: Policy): AgentStateOf {
  return (task) =>
    taskAgentState(
      task.tabs.map((t) => agentFor(agents, t.id)),
      effectivePolicy(globalPolicy, task.policy),
    );
}

/** Working tasks belong in Agent's Turn; idle, needs-you and agent-less tasks in Your Turn. */
export function queueFor(agentState: TaskAgentState): 'yourTurn' | 'agentsTurn' {
  return agentState === 'working' ? 'agentsTurn' : 'yourTurn';
}

/** Parked and Done tasks never move on their own. */
function movesOnItsOwn(queue: Queue): boolean {
  return queue === 'yourTurn' || queue === 'agentsTurn';
}

/**
 * Automatic moves: files every Your Turn and Agent's Turn task (the open one
 * too) into the queue its agent state calls for. A task that moves gets
 * enteredAt = now. Returns the same object when nothing moves.
 */
export function reconcile(state: AppState, stateOf: AgentStateOf, now: number): AppState {
  const moves = state.tasks
    .filter((t) => movesOnItsOwn(t.queue) && queueFor(stateOf(t)) !== t.queue)
    .sort((a, b) => a.enteredAt - b.enteredAt);
  // Tasks that move together keep their order: entry times 1 ms apart, oldest first.
  return moves.reduce((s, t, i) => moveTask(s, t.id, queueFor(stateOf(t)), now + i), state);
}

/** Tasks that came back from Agent's Turn to Your Turn between two states: Claude finished or needs you. */
export function arrivals(prev: AppState, next: AppState): Task[] {
  if (prev.tasks === next.tasks) return [];
  const before = new Map(prev.tasks.map((t) => [t.id, t.queue]));
  return next.tasks.filter((t) => t.queue === 'yourTurn' && before.get(t.id) === 'agentsTurn');
}

export interface NextTaskResult {
  state: AppState;
  /** Nothing else is in Your Turn: the open task stays open (and unfiled). */
  nothingElse: boolean;
}

/**
 * Next task. Files the open task (idle or needs you -> the back of its priority
 * level in Your Turn; working -> Agent's Turn; Parked and Done stay put), then
 * opens the head of Your Turn, skipping the task just filed. If nothing else
 * is waiting, nothing changes and `nothingElse` is set.
 */
export function nextTask(state: AppState, stateOf: AgentStateOf, now: number): NextTaskResult {
  const open = findTask(state, state.openTaskId);
  const head = tasksInQueue(state, 'yourTurn').find((t) => t.id !== open?.id);
  if (!head) return { state, nothingElse: true };
  let next = state;
  if (open && movesOnItsOwn(open.queue)) {
    const queue = queueFor(stateOf(open));
    // Re-entering Your Turn sends it to the back of its priority level, even if it was already there.
    next = queue === open.queue ? reenter(next, open.id, now) : moveTask(next, open.id, queue, now);
  }
  return { state: openTask(next, head.id, now), nothingElse: false };
}

function reenter(state: AppState, id: string, now: number): AppState {
  return { ...state, tasks: state.tasks.map((t) => (t.id === id ? { ...t, enteredAt: now } : t)) };
}

export function parkTask(state: AppState, id: string, now: number): AppState {
  return moveTask(state, id, 'parked', now);
}

export function markDone(state: AppState, id: string, now: number): AppState {
  return moveTask(state, id, 'done', now);
}

/** Unparks or reopens a task, filing it by its agent state. Tasks already in Your Turn or Agent's Turn are left alone. */
export function restoreTask(state: AppState, id: string, stateOf: AgentStateOf, now: number): AppState {
  const task = findTask(state, id);
  if (!task || movesOnItsOwn(task.queue)) return state;
  return moveTask(state, id, queueFor(stateOf(task)), now);
}

/**
 * Whether the open task is the history entry at historyIndex. It isn't after
 * the open task was deleted: then nothing is open, and the position is just
 * after historyIndex.
 */
function atEntry(state: AppState): boolean {
  const current = state.history[state.historyIndex];
  return !!current && current.taskId === state.openTaskId;
}

/** The history entry Back would open, or undefined. */
function backIndex(state: AppState): number | undefined {
  const i = atEntry(state) ? state.historyIndex - 1 : state.historyIndex;
  return i >= 0 ? i : undefined;
}

export function canGoBack(state: AppState): boolean {
  return backIndex(state) !== undefined;
}

export function canGoForward(state: AppState): boolean {
  return state.historyIndex + 1 < state.history.length;
}

/** Back and Forward only change which task is open; they never move tasks or rewrite history. */
export function goBack(state: AppState): AppState {
  const i = backIndex(state);
  return i === undefined ? state : goTo(state, i);
}

export function goForward(state: AppState): AppState {
  return canGoForward(state) ? goTo(state, state.historyIndex + 1) : state;
}

function goTo(state: AppState, index: number): AppState {
  const entry = state.history[index];
  if (!entry || !findTask(state, entry.taskId)) return state;
  return { ...state, openTaskId: entry.taskId, historyIndex: index };
}
