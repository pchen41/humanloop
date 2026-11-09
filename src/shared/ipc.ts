// The API the preload script exposes to the renderer as window.humanloop.

import type { CommandId } from './commands';
import type { TabAgent } from './agents';
import type { HookStatus } from './hooks';
import type { RecordResult } from './shortcuts';
import type { AppState, Settings, SettingsPatch, TaskDraft } from './model';

/** Whether Humanloop's hooks are in ~/.claude/settings.json. */
/** 'disabled': installed, but Claude's settings turn off all hooks (disableAllHooks). */
export type HookState = HookStatus | 'unreadable' | 'disabled';

export interface InitialData {
  state: AppState;
  settings: Settings;
  homeDir: string;
  /** Claude sessions by tab id. */
  agents: Record<string, TabAgent>;
  hooks: HookState;
  /** Where Humanloop installs its hooks: Claude Code's settings.json, with ~ for home. */
  claudeSettingsPath: string;
  /** Settings was chosen from the menu before this window existed. */
  showSettings: boolean;
  /** A menu command chosen before this window existed, to run once it has loaded. */
  command: CommandId | undefined;
  /** Claude sessions from before the restart that can be resumed, by tab id. */
  resume: Record<string, ResumeOffer>;
}

/** How a tab's shell ended. `clean`: it exited with code 0 (you typed `exit`), not killed by a signal. */
export interface PtyExitInfo {
  code: number;
  clean: boolean;
}

export interface ResumeOffer {
  sessionId: string;
  cwd: string;
}

export interface HumanloopApi {
  getInitialData(): Promise<InitialData>;
  onState(cb: (state: AppState) => void): () => void;
  onSettings(cb: (settings: Settings) => void): () => void;
  onCommand(cb: (id: CommandId) => void): () => void;
  onAgents(cb: (agents: Record<string, TabAgent>) => void): () => void;
  onHooks(cb: (hooks: HookState) => void): () => void;
  /** The app menu's Settings… item was chosen. */
  onShowSettings(cb: () => void): () => void;
  /** Opens Settings the way the menu does, checking the hooks again first. */
  openSettings(): void;
  /** Settings opened or closed: Back and Forward in the menu change with it. */
  settingsShown(open: boolean): void;
  onResume(cb: (offers: Record<string, ResumeOffer>) => void): () => void;
  /**
   * Types `claude --resume` for the tab's previous session into its shell, in
   * that session's directory. Returns why it couldn't, if it couldn't.
   */
  resumeSession(tabId: string): Promise<string | undefined>;
  dismissResume(tabId: string): void;

  /**
   * Captures the next key press as a shortcut, before the menu can act on it.
   * Undefined if cancelled (Esc, or stopRecording).
   */
  recordShortcut(): Promise<RecordResult | undefined>;
  stopRecording(): void;
  /**
   * Sets a command's shortcut: an accelerator, "" for none, or null for the
   * default. Checked against settings.json as it is on disk: if another
   * command has that shortcut, nothing is saved and it is returned, unless it
   * is `takeFrom`, which then loses it.
   */
  setShortcut(id: CommandId, value: string | null, takeFrom?: CommandId): Promise<{ conflict?: CommandId }>;
  /** Saves a change from the settings screen to settings.json. */
  updateSettings(patch: SettingsPatch): Promise<void>;
  /** Opens settings.json in your editor (for shortcuts). */
  openSettingsFile(): void;
  /** Install, update or remove the hooks, after a confirmation. */
  installHooks(): Promise<void>;
  removeHooks(): Promise<void>;

  createTask(draft: TaskDraft): Promise<string>;
  updateTask(id: string, patch: Partial<TaskDraft>): Promise<void>;
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
  /** Moves the open task to Done (its tabs stay open), or reopens it if done. */
  toggleDone(): Promise<void>;
  /** Deletes a task and closes its tabs, after a confirmation. True if it was deleted. */
  deleteTask(id: string): Promise<boolean>;
  /** Shows the native context menu for a task (Edit, Park, Done, Delete). */
  /** `at`: where to open it, in window coordinates (default: at the pointer). */
  showTaskMenu(id: string, at?: { x: number; y: number }): void;
  /** The task menu's Edit item was chosen. */
  onEditTask(cb: (id: string) => void): () => void;
  chooseDirectory(current?: string): Promise<string | undefined>;

  /** Adds a shell tab to the task, starting in `fromTabId`'s current directory if given. */
  newTab(taskId: string, fromTabId?: string): Promise<string>;
  /** Asks for confirmation if a program is still running, then closes the tab. */
  closeTab(tabId: string): Promise<boolean>;

  /**
   * Shows the tab's shell, starting one if it has none. If its shell ended
   * while nothing was showing it, returns that exit with the shell's last
   * output; `restart` starts a new shell instead.
   */
  ptyAttach(tabId: string, cols: number, rows: number, restart?: boolean): Promise<{ replay: string; exited?: PtyExitInfo }>;
  ptyWrite(tabId: string, data: string): void;
  ptyResize(tabId: string, cols: number, rows: number): void;
  ptyAck(tabId: string, chars: number): void;
  onPtyData(cb: (tabId: string, data: string) => void): () => void;
  onPtyExit(cb: (tabId: string, exit: PtyExitInfo) => void): () => void;

  /** Lets the Edit menu send ⌘C and ⌘A to the terminal instead of the page. */
  /** Edit > Copy and Select All: the renderer decides whether they mean a terminal or the page. */
  onTerminalEdit(cb: (cmd: TerminalEditCommand) => void): () => void;
  /** Runs Copy or Select All on the page itself (a text field, a selection outside the terminals). */
  pageEdit(cmd: TerminalEditCommand): void;
  writeClipboard(text: string): void;
  /** File paths for files dropped on the window. */
  pathsForFiles(files: File[]): string[];
}

export const IPC = {
  getInitialData: 'app:initial-data',
  state: 'app:state',
  settings: 'app:settings',
  agents: 'app:agents',
  hooks: 'app:hooks',
  showSettings: 'app:show-settings',
  openSettings: 'app:open-settings',
  settingsShown: 'app:settings-shown',
  resume: 'app:resume',
  resumeSession: 'resume:run',
  dismissResume: 'resume:dismiss',
  updateSettings: 'settings:update',
  recordShortcut: 'shortcut:record',
  stopRecording: 'shortcut:stop',
  setShortcut: 'shortcut:set',
  openSettingsFile: 'settings:open-file',
  installHooks: 'hooks:install',
  removeHooks: 'hooks:remove',
  command: 'app:command',
  createTask: 'task:create',
  updateTask: 'task:update',
  openTask: 'task:open',
  nextTask: 'task:next',
  goBack: 'history:back',
  goForward: 'history:forward',
  toggleParked: 'task:toggle-parked',
  toggleDone: 'task:toggle-done',
  deleteTask: 'task:delete',
  taskMenu: 'task:menu',
  editTask: 'task:edit',
  chooseDirectory: 'dialog:directory',
  newTab: 'tab:new',
  closeTab: 'tab:close',
  ptyAttach: 'pty:attach',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyAck: 'pty:ack',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  pageEdit: 'page:edit',
  unload: 'page:unload',
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
