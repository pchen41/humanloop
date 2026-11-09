// Turns whatever is on disk into valid state, dropping anything malformed.

import { COMMANDS } from './commands';
import {
  DEFAULT_POLICY,
  DEFAULT_PRIORITY,
  QUEUES,
  type AppState,
  type Policy,
  type Priority,
  type Queue,
  type Settings,
  type Tab,
  type Task,
} from './model';
import { HISTORY_LIMIT } from './tasks';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function priority(v: unknown): Priority {
  const n = num(v);
  return n !== undefined && Number.isInteger(n) && n >= 0 && n <= 9 ? (n as Priority) : DEFAULT_PRIORITY;
}

function policyPatch(v: unknown): Partial<Policy> {
  if (!isObj(v)) return {};
  const out: Partial<Policy> = {};
  if (v.multiAgent === 'any' || v.multiAgent === 'all') out.multiAgent = v.multiAgent;
  if (typeof v.subagentsBusy === 'boolean') out.subagentsBusy = v.subagentsBusy;
  if (typeof v.backgroundShellsBusy === 'boolean') out.backgroundShellsBusy = v.backgroundShellsBusy;
  return out;
}

function tab(v: unknown): Tab | undefined {
  if (!isObj(v) || !str(v.id)) return undefined;
  const out: Tab = { id: v.id as string, title: str(v.title) ?? 'zsh' };
  const s = v.claudeSession;
  if (isObj(s) && str(s.id) && str(s.cwd)) out.claudeSession = { id: s.id as string, cwd: s.cwd as string };
  return out;
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
    policy: policyPatch(v.policy),
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
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
    .map((t) => task(t, now))
    .filter((t): t is Task => {
      if (!t || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
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
  if (history.length) historyIndex = Math.max(0, Math.min(historyIndex, history.length - 1));
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

const KNOWN_COMMANDS = new Set<string>(COMMANDS.map((c) => c.id));

export function normalizeSettings(raw: unknown): Settings {
  if (!isObj(raw)) throw new Error('settings is not an object');
  const shortcuts: Record<string, string> = {};
  if (isObj(raw.shortcuts)) {
    for (const [k, v] of Object.entries(raw.shortcuts)) {
      if (KNOWN_COMMANDS.has(k) && typeof v === 'string') shortcuts[k] = v;
    }
  }
  const out: Settings = { policy: { ...DEFAULT_POLICY, ...policyPatch(raw.policy) }, shortcuts };
  const cwd = str(raw.defaultCwd);
  if (cwd) out.defaultCwd = cwd;
  return out;
}
