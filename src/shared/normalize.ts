// Turns whatever is on disk into valid state, dropping anything malformed.

import { COMMAND_IDS } from './commands';
import {
  cleanPolicy,
  cleanTabPolicy,
  DEFAULT_POLICY,
  DEFAULT_PRIORITY,
  DEFAULT_SETTINGS,
  PRIORITIES,
  QUEUES,
  type AppState,
  type Priority,
  type Queue,
  type Settings,
  type Tab,
  type Task,
} from './model';
import { cleanShortcuts } from './shortcuts';
import { HISTORY_LIMIT } from './tasks';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function priority(v: unknown): Priority {
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : DEFAULT_PRIORITY;
}

function tab(v: unknown): Tab | undefined {
  if (!isObj(v) || !str(v.id)) return undefined;
  const out: Tab = { id: v.id as string, title: str(v.title) ?? 'zsh' };
  const s = v.claudeSession;
  if (isObj(s) && str(s.id) && str(s.cwd)) out.claudeSession = { id: s.id as string, cwd: s.cwd as string };
  if (v.muted === true) out.muted = true;
  const policy = cleanTabPolicy(v.policy);
  if (Object.keys(policy).length) out.policy = policy;
  return out;
}

function uniqueTab(tab: Tab, used: Set<string>): Tab {
  if (!used.has(tab.id)) {
    used.add(tab.id);
    return tab;
  }
  let n = 2;
  while (used.has(`${tab.id}-${n}`)) n++;
  const id = `${tab.id}-${n}`;
  used.add(id);
  const { claudeSession: _session, ...rest } = tab; // the Claude session belongs to the first copy
  return { ...rest, id };
}

function task(v: unknown, now: number): Task | undefined {
  if (!isObj(v) || !str(v.id)) return undefined;
  const queue: Queue = QUEUES.includes(v.queue as Queue) ? (v.queue as Queue) : 'yourTurn';
  const out: Task = {
    id: v.id as string,
    title: str(v.title) || 'Untitled task',
    description: str(v.description) ?? '',
    priority: priority(v.priority),
    queue,
    enteredAt: num(v.enteredAt) ?? now,
    policy: cleanPolicy(v.policy),
    tabs: Array.isArray(v.tabs) ? v.tabs.map(tab).filter((t): t is Tab => !!t) : [],
    createdAt: num(v.createdAt) ?? now,
  };
  const cwd = str(v.defaultCwd);
  if (cwd) out.defaultCwd = cwd;
  return out;
}

export function normalizeState(raw: unknown, now = Date.now()): AppState {
  if (!isObj(raw)) throw new Error('state is not an object');
  const seen = new Set<string>();
  const tabIds = new Set<string>();
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
    .map((t) => task(t, now))
    .filter((t): t is Task => {
      if (!t || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    })
    // Two tabs with one id would share a shell (closing one kills the other), so later copies get their own.
    .map((t) => ({ ...t, tabs: t.tabs.map((tab) => uniqueTab(tab, tabIds)) }));
  // Drop entries for missing tasks while keeping the index on the same entry it pointed at.
  const rawHistory = Array.isArray(raw.history) ? raw.history : [];
  const rawIndex = num(raw.historyIndex) ?? rawHistory.length - 1;
  let history: AppState['history'] = [];
  let historyIndex = -1;
  rawHistory.forEach((h, i) => {
    if (!isObj(h) || typeof h.taskId !== 'string' || !seen.has(h.taskId)) return;
    if (history.at(-1)?.taskId === h.taskId) {
      if (i <= rawIndex) historyIndex = history.length - 1;
      return;
    }
    history.push({ taskId: h.taskId, openedAt: num(h.openedAt) ?? now });
    if (i <= rawIndex) historyIndex = history.length - 1;
  });
  if (history.length > HISTORY_LIMIT) {
    historyIndex -= history.length - HISTORY_LIMIT;
    history = history.slice(-HISTORY_LIMIT);
  }
  historyIndex = Math.max(-1, Math.min(historyIndex, history.length - 1));
  const openTaskId = str(raw.openTaskId);
  return {
    tasks,
    openTaskId: openTaskId && seen.has(openTaskId) ? openTaskId : undefined,
    history,
    historyIndex,
  };
}

/**
 * Agent state is never saved, so after a restart nothing is known to be
 * working: tasks in Agent's Turn go back to Your Turn.
 */
export function stateAfterLaunch(state: AppState, now = Date.now()): AppState {
  // Keep their relative order by spacing the new entry times 1 ms apart.
  const order = state.tasks
    .filter((t) => t.queue === 'agentsTurn')
    .sort((a, b) => a.enteredAt - b.enteredAt)
    .map((t) => t.id);
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.queue === 'agentsTurn' ? { ...t, queue: 'yourTurn', enteredAt: now + order.indexOf(t.id) } : t,
    ),
  };
}

export function normalizeSettings(raw: unknown): Settings {
  if (!isObj(raw)) throw new Error('settings is not an object');
  const given: Record<string, string> = {};
  if (isObj(raw.shortcuts)) {
    for (const [k, v] of Object.entries(raw.shortcuts)) {
      if (COMMAND_IDS.has(k) && typeof v === 'string') given[k] = v;
    }
  }
  const shortcuts = cleanShortcuts(given);
  const out: Settings = {
    policy: { ...DEFAULT_POLICY, ...cleanPolicy(raw.policy) },
    shortcuts,
    notifications: typeof raw.notifications === 'boolean' ? raw.notifications : DEFAULT_SETTINGS.notifications,
    keepAwake: typeof raw.keepAwake === 'boolean' ? raw.keepAwake : DEFAULT_SETTINGS.keepAwake,
    optionAsMeta: typeof raw.optionAsMeta === 'boolean' ? raw.optionAsMeta : DEFAULT_SETTINGS.optionAsMeta,
    newTabsInCurrentDir:
      typeof raw.newTabsInCurrentDir === 'boolean' ? raw.newTabsInCurrentDir : DEFAULT_SETTINGS.newTabsInCurrentDir,
  };
  const cwd = str(raw.defaultCwd)?.trim();
  if (cwd) out.defaultCwd = cwd;
  return out;
}
