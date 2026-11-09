import { randomUUID } from 'node:crypto';
import { existsSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import { COMMANDS } from '../shared/commands';
import { IPC, TERMINAL_EDIT, type InitialData, type TerminalEditCommand } from '../shared/ipc';
import { DEFAULT_SETTINGS, EMPTY_STATE, type AppState, type Settings, type TaskDraft } from '../shared/model';
import { normalizeSettings, normalizeState, stateAfterLaunch } from '../shared/normalize';
import * as T from '../shared/tasks';
import { AgentTracker } from './agentTracker';
import { currentHookStatus, installWithConfirm, removeWithConfirm } from './hookInstaller';
import { HookServer, hookSocketPath } from './hookServer';
import { acceleratorFor, buildMenu } from './menu';
import { PtyManager, shellEnv, usableCwd } from './pty';
import { runSmokeTest } from './smoke';
import { JsonStore, readJson, writeJsonSync } from './store';

// Dev builds keep their own data so they never touch the installed app's tasks.
if (process.env.HUMANLOOP_USER_DATA) {
  app.setPath('userData', process.env.HUMANLOOP_USER_DATA);
} else if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Humanloop Dev'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const userData = app.getPath('userData');
const stateFile = join(userData, 'state.json');
const settingsFile = join(userData, 'settings.json');
const stateStore = new JsonStore<AppState>(stateFile);

let state: AppState = stateAfterLaunch(readJson(stateFile, EMPTY_STATE, normalizeState));
let settings: Settings = readJson(settingsFile, DEFAULT_SETTINGS, normalizeSettings);
let win: BrowserWindow | undefined;
let terminalFocused = false;
/** Lets the smoke test watch terminal output. */
let outputObserver: ((tabId: string, data: string) => void) | undefined;

const ptys = new PtyManager({
  data(tabId, data) {
    outputObserver?.(tabId, data);
    win?.webContents.send(IPC.ptyData, tabId, data);
  },
  exit(tabId, exitCode) {
    tracker.clear(tabId);
    win?.webContents.send(IPC.ptyExit, tabId, exitCode);
  },
});

const hookSocket = hookSocketPath(userData);
const tracker = new AgentTracker({
  shellPid: (tabId) => (ptys.has(tabId) ? ptys.pid(tabId) : undefined),
  onChange: () => win?.webContents.send(IPC.agents, tracker.snapshot()),
  // HUMANLOOP_HOOK_LOG=1 records every hook delivery, for checking how Claude Code behaves.
  logFile: process.env.HUMANLOOP_HOOK_LOG ? join(userData, 'hook-events.jsonl') : undefined,
});
const hookServer = new HookServer(hookSocket, (d) => tracker.handle(d));

function setState(next: AppState): void {
  if (next === state) return;
  state = next;
  stateStore.save(state);
  win?.webContents.send(IPC.state, state);
}

// ---------- settings ----------

function writeDefaultSettings(): void {
  // Spell out every shortcut so the file is easy to edit.
  const shortcuts = Object.fromEntries(COMMANDS.map((c) => [c.id, acceleratorFor(settings, c.id) ?? '']));
  writeJsonSync(settingsFile, { ...settings, shortcuts });
}

function watchSettings(): void {
  let timer: NodeJS.Timeout | undefined;
  try {
    watch(userData, (_event, name) => {
      if (name !== 'settings.json') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        settings = readJson(settingsFile, settings, normalizeSettings);
        installMenu();
        win?.webContents.send(IPC.settings, settings);
      }, 200);
    });
  } catch (err) {
    console.error('Could not watch settings.json:', err);
  }
}

function installMenu(): void {
  Menu.setApplicationMenu(
    buildMenu(settings, {
      command: (id) => win?.webContents.send(IPC.command, id),
      copy: () => editCommand('copy'),
      selectAll: () => editCommand('selectAll'),
      openSettings: () => void shell.openPath(settingsFile),
      installHooks: () => void installWithConfirm(win).then(installMenu),
      removeHooks: () => void removeWithConfirm(win).then(installMenu),
    }, currentHookStatus()),
  );
}

function editCommand(cmd: TerminalEditCommand): void {
  if (!win) return;
  if (terminalFocused) win.webContents.send(TERMINAL_EDIT, cmd);
  else if (cmd === 'copy') win.webContents.copy();
  else win.webContents.selectAll();
}

// ---------- tasks and tabs ----------

function newTab(taskId: string): string {
  const id = randomUUID();
  setState(T.addTab(state, taskId, { id, title: 'zsh' }));
  return id;
}

/** Creates, opens and gives a first shell tab to a task in a single state update. */
function createTask(draft: TaskDraft): { taskId: string; tabId: string } {
  const taskId = randomUUID();
  const tabId = randomUUID();
  const now = Date.now();
  let next = T.createTask(state, draft, taskId, now);
  next = T.addTab(next, taskId, { id: tabId, title: 'zsh' });
  setState(T.openTask(next, taskId, now));
  return { taskId, tabId };
}

function isShell(name: string | undefined): boolean {
  return !name || /^-?(zsh|bash|sh|login)$/.test(name);
}

/** Tabs whose foreground program is something other than the shell. */
function busyTabs(tabIds: string[]): string[] {
  return tabIds.filter((id) => !isShell(ptys.foregroundProcess(id)));
}

async function confirm(message: string, detail: string, action: string): Promise<boolean> {
  const opts = { type: 'warning' as const, message, detail, buttons: [action, 'Cancel'], defaultId: 0, cancelId: 1 };
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return response === 0;
}

async function deleteTaskWithConfirm(id: string): Promise<boolean> {
  const task = T.findTask(state, id);
  if (!task) return false;
  const tabs = task.tabs.length;
  const ok = await confirm(
    `Delete “${task.title}”?`,
    `${tabs ? `This closes its ${tabs === 1 ? 'tab' : `${tabs} tabs`} and removes` : 'This removes'} it from your history. You can't undo this.`,
    'Delete',
  );
  if (!ok) return false;
  // Tabs may have changed while the dialog was open.
  for (const tab of T.findTask(state, id)?.tabs ?? []) {
    ptys.kill(tab.id);
    tracker.clear(tab.id);
  }
  setState(T.deleteTask(state, id));
  return true;
}

function registerIpc(): void {
  ipcMain.handle(
    IPC.getInitialData,
    (): InitialData => ({ state, settings, homeDir: homedir(), agents: tracker.snapshot() }),
  );

  ipcMain.handle(IPC.createTask, (_e, draft: TaskDraft) => createTask(draft).taskId);
  ipcMain.handle(IPC.updateTask, (_e, id: string, patch: Partial<TaskDraft>) => {
    setState(T.updateTask(state, id, patch));
  });
  ipcMain.handle(IPC.deleteTask, (_e, id: string) => deleteTaskWithConfirm(id));
  ipcMain.handle(IPC.openTask, (_e, id: string) => {
    setState(T.openTask(state, id, Date.now()));
  });
  ipcMain.on(IPC.taskMenu, (_e, id: string) => {
    Menu.buildFromTemplate([
      { label: 'Edit Task…', click: () => win?.webContents.send(IPC.editTask, id) },
      { type: 'separator' },
      { label: 'Delete Task…', click: () => void deleteTaskWithConfirm(id) },
    ]).popup({ window: win });
  });
  ipcMain.handle(IPC.chooseDirectory, async (_e, current?: string) => {
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: usableCwd(current),
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? undefined : res.filePaths[0];
  });

  ipcMain.handle(IPC.newTab, (_e, taskId: string) => newTab(taskId));
  ipcMain.handle(IPC.closeTab, async (_e, tabId: string) => {
    const found = T.findTab(state, tabId);
    if (!found) return false;
    const program = ptys.foregroundProcess(tabId);
    if (!isShell(program) && !(await confirm('Close this tab?', `${program} is still running in it.`, 'Close Tab'))) {
      return false;
    }
    ptys.kill(tabId);
    tracker.clear(tabId);
    setState(T.closeTab(state, found.task.id, tabId));
    return true;
  });
  ipcMain.on(IPC.setTabTitle, (_e, tabId: string, title: string) => {
    const found = T.findTab(state, tabId);
    if (found && found.tab.title !== title) setState(T.updateTab(state, tabId, { title }));
  });

  ipcMain.handle(IPC.ptyAttach, (_e, tabId: string, cols: number, rows: number) => {
    const found = T.findTab(state, tabId);
    if (!found) throw new Error(`no tab ${tabId}`);
    return ptys.attach(tabId, {
      cols,
      rows,
      cwd: usableCwd(found.task.defaultCwd ?? settings.defaultCwd),
      env: shellEnv({
        HUMANLOOP_TAB: tabId,
        HUMANLOOP_SOCK: hookSocket,
        TERM_PROGRAM: 'Humanloop',
        TERM_PROGRAM_VERSION: app.getVersion(),
      }),
    });
  });
  ipcMain.on(IPC.ptyWrite, (_e, tabId: string, data: string) => {
    // A lone Esc byte is the Esc key (arrow keys and Option combos arrive as longer sequences).
    if (data === '\x1b') tracker.interrupt(tabId);
    ptys.write(tabId, data);
  });
  ipcMain.on(IPC.ptyResize, (_e, tabId: string, cols: number, rows: number) => ptys.resize(tabId, cols, rows));
  ipcMain.on(IPC.ptyAck, (_e, tabId: string, chars: number) => ptys.ack(tabId, chars));
  ipcMain.on(IPC.terminalFocus, (_e, focused: boolean) => {
    terminalFocused = focused;
  });
  ipcMain.on(IPC.clipboard, (_e, text: string) => clipboard.writeText(text));
}

// ---------- window ----------

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 420,
    show: false,
    title: 'Humanloop',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1a1c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  w.once('ready-to-show', () => {
    // The smoke test shows the window without taking focus, so fonts are
    // measured on a real screen just like a normal launch.
    if (process.env.HUMANLOOP_SMOKE) w.showInactive();
    else w.show();
  });
  w.on('closed', () => {
    if (win === w) win = undefined;
    terminalFocused = false;
    ptys.detachAll();
  });
  // A reload replaces the renderer and its terminals; tabs re-attach as they are shown.
  w.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) ptys.detachAll();
  });
  // Links open in the browser; the window itself never navigates away.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e) => e.preventDefault());

  // Only dev builds load from the Vite dev server; a packaged app always loads its own files.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void w.loadFile(join(__dirname, '../renderer/index.html'));
  return w;
}

// ---------- lifecycle ----------

/** Set once the quit has been confirmed and state is safely on disk. */
let readyToQuit = false;
let quitting = false;

app.on('second-instance', () => {
  if (!win) win = createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('activate', () => {
  if (!win) win = createWindow();
});

app.on('before-quit', (e) => {
  if (readyToQuit) return;
  e.preventDefault();
  if (quitting) return;
  quitting = true;
  void (async () => {
    try {
      const busy = busyTabs(state.tasks.flatMap((t) => t.tabs.map((tab) => tab.id)));
      const ok =
        !busy.length ||
        (await confirm(
          'Quit Humanloop?',
          `${busy.length === 1 ? 'A program is' : `${busy.length} programs are`} still running in your tabs. Quitting stops them.`,
          'Quit',
        ));
      if (!ok) return;
      await stateStore.flush();
      readyToQuit = true;
      app.quit();
    } finally {
      quitting = false;
    }
  })();
});

app.on('will-quit', () => {
  hookServer.stop();
  stateStore.flushSync();
  ptys.killAll();
});

// Keep running with no window, like other Mac apps; ⌘Q quits.
app.on('window-all-closed', () => {});

void app.whenReady().then(async () => {
  try {
    await hookServer.start();
  } catch (err) {
    // The app still works as a terminal; agent state just won't update.
    console.error(`Could not listen on ${hookSocket}:`, err);
    dialog.showErrorBox(
      "Humanloop can't track Claude",
      `Humanloop could not open its hook socket at ${hookSocket}, so it won't see what Claude is doing in its tabs. Terminals still work.\n\n${String(err)}`,
    );
  }
  if (!existsSync(settingsFile)) writeDefaultSettings();
  watchSettings();
  installMenu();
  registerIpc();
  win = createWindow();
  setState(state); // no-op unless launch reconciliation changed something
  stateStore.save(state);

  if (process.env.HUMANLOOP_SMOKE) {
    void runSmokeTest({
      win,
      createTaskAndTab: () => createTask({ title: 'Smoke test', description: '', priority: 5 }),
      writeToTab: (tabId, data) => ptys.write(tabId, data),
      observeOutput: (fn) => {
        outputObserver = fn;
      },
    });
  }
});
