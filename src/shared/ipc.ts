// The API the preload script exposes to the renderer as window.humanloop.

import type { CommandId } from './commands';
import type { AppState, Settings, TaskDraft } from './model';

export interface InitialData {
  state: AppState;
  settings: Settings;
  homeDir: string;
}

export interface HumanloopApi {
  getInitialData(): Promise<InitialData>;
  onState(cb: (state: AppState) => void): () => void;
  onSettings(cb: (settings: Settings) => void): () => void;
  onCommand(cb: (id: CommandId) => void): () => void;

  createTask(draft: TaskDraft): Promise<string>;
  updateTask(id: string, patch: Partial<TaskDraft>): Promise<void>;
  /** Asks for confirmation, then closes the task's shells and deletes it. */
  deleteTask(id: string): Promise<boolean>;
  openTask(id: string): Promise<void>;
  /** Shows the native context menu for a task (Edit, Delete). */
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
  command: 'app:command',
  createTask: 'task:create',
  updateTask: 'task:update',
  deleteTask: 'task:delete',
  openTask: 'task:open',
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
