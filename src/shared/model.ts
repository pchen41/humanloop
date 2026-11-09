// Data model shared by the main process, preload bridge and renderer.
// Everything in AppState is saved to disk; runtime-only state lives elsewhere.

export type Queue = 'yourTurn' | 'agentsTurn' | 'parked' | 'done';

export const QUEUES: readonly Queue[] = ['yourTurn', 'agentsTurn', 'parked', 'done'];

export const QUEUE_LABELS: Record<Queue, string> = {
  yourTurn: 'Your Turn',
  agentsTurn: "Agent's Turn",
  parked: 'Parked',
  done: 'Done',
};

/** P0 comes first. */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const DEFAULT_PRIORITY: Priority = 5;

export interface Policy {
  multiAgent: 'any' | 'all';
  subagentsBusy: boolean;
  backgroundShellsBusy: boolean;
}

export const DEFAULT_POLICY: Policy = {
  multiAgent: 'any',
  subagentsBusy: true,
  backgroundShellsBusy: false,
};

export const POLICY_KEYS = ['multiAgent', 'subagentsBusy', 'backgroundShellsBusy'] as const;

/** The task's overrides on top of the global policy. */
export function effectivePolicy(global: Policy, task: Partial<Policy>): Policy {
  return { ...global, ...task };
}

/** Keeps only valid policy fields. Values arrive from disk and over IPC, so nothing is trusted. */
export function cleanPolicy(v: unknown): Partial<Policy> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: Partial<Policy> = {};
  if (o.multiAgent === 'any' || o.multiAgent === 'all') out.multiAgent = o.multiAgent;
  if (typeof o.subagentsBusy === 'boolean') out.subagentsBusy = o.subagentsBusy;
  if (typeof o.backgroundShellsBusy === 'boolean') out.backgroundShellsBusy = o.backgroundShellsBusy;
  return out;
}

export function hasOverrides(task: Task): boolean {
  return POLICY_KEYS.some((k) => task.policy[k] !== undefined);
}

export interface Tab {
  id: string;
  title: string;
  claudeSession?: { id: string; cwd: string };
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  queue: Queue;
  /** When the task entered its current queue. Used for FIFO order within a priority. */
  enteredAt: number;
  defaultCwd?: string;
  policy: Partial<Policy>;
  tabs: Tab[];
  createdAt: number;
}

export interface HistoryEntry {
  taskId: string;
  openedAt: number;
}

export interface AppState {
  tasks: Task[];
  openTaskId?: string;
  history: HistoryEntry[];
  historyIndex: number;
}

/** User-editable settings, kept in their own file (settings.json). */
export interface Settings {
  policy: Policy;
  /** Action id -> Electron accelerator string. Missing entries use the defaults. */
  shortcuts: Record<string, string>;
  defaultCwd?: string;
}

export const EMPTY_STATE: AppState = { tasks: [], history: [], historyIndex: -1 };

export const DEFAULT_SETTINGS: Settings = { policy: DEFAULT_POLICY, shortcuts: {} };

/** A change made in the settings screen. A null defaultCwd clears it. */
export interface SettingsPatch {
  policy?: Partial<Policy>;
  defaultCwd?: string | null;
}

/**
 * Applies a settings screen change to settings.json's contents as they are on
 * disk. Only the fields the change names are touched, so hand edits (and
 * anything else in the file) are kept; invalid values are ignored.
 */
export function patchSettingsJson(raw: Record<string, unknown>, patch: SettingsPatch): Record<string, unknown> {
  const out = { ...raw };
  const policy = cleanPolicy(patch.policy);
  if (Object.keys(policy).length) {
    const current = typeof raw.policy === 'object' && raw.policy !== null && !Array.isArray(raw.policy) ? raw.policy : {};
    out.policy = { ...current, ...policy };
  }
  if ('defaultCwd' in patch && (patch.defaultCwd === null || typeof patch.defaultCwd === 'string')) {
    const cwd = patch.defaultCwd?.trim();
    if (cwd) out.defaultCwd = cwd;
    else delete out.defaultCwd;
  }
  return out;
}

export interface TaskDraft {
  title: string;
  description: string;
  priority: Priority;
  defaultCwd?: string;
  /** Readiness overrides; fields left out use the global settings. */
  policy?: Partial<Policy>;
}
