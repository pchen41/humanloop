// The API the preload script exposes to the renderer as window.humanloop.

import type { CommandId } from './commands';
import type { TabAgent } from './agents';
import type { AppState, Settings, TaskDraft } from './model';

export interface InitialData {
  state: AppState;
  settings: Settings;
  homeDir: string;
  /** Claude sessions by tab id. */
  agents: Record<string, TabAgent>;
}

export interface HumanloopApi {
  getInitialData(): Promise<InitialData>;
  onState(cb: (state: AppState) => void): () => void;
  onSettings(cb: (settings: Settings) => void): () => void;
  onCommand(cb: (id: CommandId) => void): () => void;
  onAgents(cb: (agents: Record<string, TabAgent>) => void): () => void;

  createTask(draft: TaskDraft): Promise<string>;
  updateTask(id: string, patch: Partial<TaskDraft>): Promise<void>;
  /** Asks for confirmation, then closes the task's shells and deletes it. */
  deleteTask(id: string): Promise<boolean>;
  openTask(id: string): Promise<void>;
  /** Files the open task and opens the next one in Your Turn. */
  nextTask(): Promise<{ nothingElse: boolean }>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  /**
   * Parks the open task, or unparks it if parked. Acts on whichever task main
   * has open, so it can't hit the previous task right after Next or Back.
   */
  toggleParked(): Promise<void>;
  /** Marks the open task done (offering to close its tabs), or reopens it if done. */
  toggleDone(): Promise<void>;
  /** Shows the native context menu for a task (Edit, Park, Done, Delete). */
  showTaskMenu(id: string): void;
  /** The task menu's Edit item was chosen. */
  onEditTask(cb: (id: string) => void): () => void;
  chooseDirectory(current?: string): Promise<string | undefined>;

  newTab(taskId: string): Promise<string>;
  /** Asks for confirmation if a program is still running, then closes the tab. */
  closeTab(tabId: string): Promise<boolean>;
  setTabTitle(tabId: string, title: string): void;

  ptyAttach(tabId: string, cols: number, rows: number): Promise<{ replay: string }>;
  ptyWrite(tabId: string, data: string): void;
  ptyResize(tabId: string, cols: number, rows: number): void;
  ptyAck(tabId: string, chars: number): void;
  onPtyData(cb: (tabId: string, data: string) => void): () => void;
  onPtyExit(cb: (tabId: string, exitCode: number) => void): () => void;

  /** Lets the Edit menu send ⌘C and ⌘A to the terminal instead of the page. */
  setTerminalFocused(focused: boolean): void;
  onTerminalEdit(cb: (cmd: TerminalEditCommand) => void): () => void;
  writeClipboard(text: string): void;
}

export const IPC = {
  getInitialData: 'app:initial-data',
  state: 'app:state',
  settings: 'app:settings',
  agents: 'app:agents',
  command: 'app:command',
  createTask: 'task:create',
  updateTask: 'task:update',
  deleteTask: 'task:delete',
  openTask: 'task:open',
  nextTask: 'task:next',
  goBack: 'history:back',
  goForward: 'history:forward',
  toggleParked: 'task:toggle-parked',
  toggleDone: 'task:toggle-done',
  taskMenu: 'task:menu',
  editTask: 'task:edit',
  chooseDirectory: 'dialog:directory',
  newTab: 'tab:new',
  closeTab: 'tab:close',
  setTabTitle: 'tab:title',
  ptyAttach: 'pty:attach',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyAck: 'pty:ack',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  terminalFocus: 'term:focus',
  clipboard: 'clipboard:write',
} as const;

/** Commands the Edit menu sends to the focused terminal. */
export type TerminalEditCommand = 'copy' | 'selectAll';
export const TERMINAL_EDIT = 'term:edit';

declare global {
  interface Window {
    humanloop: HumanloopApi;
  }
}
