// Pure state updates for tasks, tabs and history. No Electron imports, so
// these run in unit tests and in either process.

import { cleanPolicy, DEFAULT_PRIORITY, PRIORITIES, type AppState, type Priority, type Queue, type Tab, type Task, type TaskDraft } from './model';

export const HISTORY_LIMIT = 500;

/** Queue order: priority first (P0 before P9), then first-in first-out. */
export function compareTasks(a: Task, b: Task): number {
  return a.priority - b.priority || a.enteredAt - b.enteredAt || a.createdAt - b.createdAt;
}

export function tasksInQueue(state: AppState, queue: Queue): Task[] {
  return state.tasks.filter((t) => t.queue === queue).sort(compareTasks);
}

export function findTask(state: AppState, id: string | undefined): Task | undefined {
  return id === undefined ? undefined : state.tasks.find((t) => t.id === id);
}

function mapTask(state: AppState, id: string, fn: (t: Task) => Task): AppState {
  let found = false;
  const tasks = state.tasks.map((t) => {
    if (t.id !== id) return t;
    found = true;
    return fn(t);
  });
  if (!found) throw new Error(`no task ${id}`);
  return { ...state, tasks };
}

/** Keeps only the editable fields, with valid values. Drafts arrive over IPC, so nothing is trusted. */
function cleanDraft(draft: Partial<TaskDraft>): Partial<TaskDraft> {
  const out: Partial<TaskDraft> = {};
  if (typeof draft.title === 'string') out.title = draft.title.trim() || 'Untitled task';
  if (typeof draft.description === 'string') out.description = draft.description.trim();
  if (PRIORITIES.includes(draft.priority as Priority)) out.priority = draft.priority;
  if ('defaultCwd' in draft) {
    out.defaultCwd = typeof draft.defaultCwd === 'string' ? draft.defaultCwd.trim() || undefined : undefined;
  }
  if ('policy' in draft) out.policy = cleanPolicy(draft.policy);
  return out;
}

export function createTask(state: AppState, draft: TaskDraft, id: string, now: number): AppState {
  const task: Task = {
    id,
    title: 'Untitled task',
    description: '',
    priority: DEFAULT_PRIORITY,
    queue: 'yourTurn',
    enteredAt: now,
    policy: {},
    tabs: [],
    createdAt: now,
    ...cleanDraft(draft),
  };
  return { ...state, tasks: [...state.tasks, task] };
}

/** Edits title, description, priority, directory or readiness overrides. A priority change re-sorts but keeps enteredAt. */
export function updateTask(state: AppState, id: string, patch: Partial<TaskDraft>): AppState {
  return mapTask(state, id, (t) => ({ ...t, ...cleanDraft(patch) }));
}

export function moveTask(state: AppState, id: string, queue: Queue, now: number): AppState {
  return mapTask(state, id, (t) => (t.queue === queue ? t : { ...t, queue, enteredAt: now }));
}

export function deleteTask(state: AppState, id: string): AppState {
  const kept: AppState['history'] = [];
  let historyIndex = state.historyIndex;
  state.history.forEach((entry, i) => {
    if (entry.taskId === id) {
      if (i <= state.historyIndex) historyIndex--;
      return;
    }
    // Removing an entry can leave two opens of the same task next to each other.
    if (kept.at(-1)?.taskId === entry.taskId) {
      if (i <= state.historyIndex) historyIndex--;
      return;
    }
    kept.push(entry);
  });
  // Deleting the open task leaves nothing open, positioned just after the entry
  // before it (-1 if it was the first): Back opens that entry, Forward the next.
  historyIndex = Math.max(-1, Math.min(historyIndex, kept.length - 1));
  return {
    ...state,
    tasks: state.tasks.filter((t) => t.id !== id),
    openTaskId: state.openTaskId === id ? undefined : state.openTaskId,
    history: kept,
    historyIndex,
  };
}

/** Opens a task and records it in history like a browser: forward entries are dropped. */
export function openTask(state: AppState, id: string, now: number): AppState {
  if (!findTask(state, id)) throw new Error(`no task ${id}`);
  if (state.openTaskId === id) return state;
  let history = state.history.slice(0, state.historyIndex + 1);
  if (history.at(-1)?.taskId !== id) history.push({ taskId: id, openedAt: now });
  if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);
  return { ...state, openTaskId: id, history, historyIndex: history.length - 1 };
}

export function addTab(state: AppState, taskId: string, tab: Tab): AppState {
  return mapTask(state, taskId, (t) => ({ ...t, tabs: [...t.tabs, tab] }));
}

export function closeTab(state: AppState, taskId: string, tabId: string): AppState {
  return mapTask(state, taskId, (t) => ({ ...t, tabs: t.tabs.filter((tab) => tab.id !== tabId) }));
}

/** Moves a tab to `index` among its task's tabs (clamped). */
export function moveTab(state: AppState, tabId: string, index: number): AppState {
  const found = findTab(state, tabId);
  if (!found) return state;
  const rest = found.task.tabs.filter((t) => t.id !== tabId);
  const at = Math.max(0, Math.min(Math.trunc(index), rest.length));
  if (found.task.tabs[at] === found.tab) return state;
  return mapTask(state, found.task.id, (t) => ({ ...t, tabs: [...rest.slice(0, at), found.tab, ...rest.slice(at)] }));
}

export function updateTab(state: AppState, tabId: string, patch: Partial<Omit<Tab, 'id'>>): AppState {
  const task = state.tasks.find((t) => t.tabs.some((tab) => tab.id === tabId));
  if (!task) return state;
  return mapTask(state, task.id, (t) => ({
    ...t,
    tabs: t.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)),
  }));
}

export function findTab(state: AppState, tabId: string): { task: Task; tab: Tab } | undefined {
  for (const task of state.tasks) {
    const tab = task.tabs.find((x) => x.id === tabId);
    if (tab) return { task, tab };
  }
  return undefined;
}
