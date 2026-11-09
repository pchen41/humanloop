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

export interface TaskDraft {
  title: string;
  description: string;
  priority: Priority;
  defaultCwd?: string;
}
