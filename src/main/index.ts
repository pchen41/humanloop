import { randomUUID } from 'node:crypto';
import { existsSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { COMMAND_IDS, commandById, type CommandId } from '../shared/commands';
import { IPC, TERMINAL_EDIT, type InitialData, type ResumeOffer, type TerminalEditCommand } from '../shared/ipc';
import {
  DEFAULT_SETTINGS,
  effectivePolicy,
  patchSettingsJson,
  EMPTY_STATE,
  type AppState,
  type Settings,
  type SettingsPatch,
  type TaskDraft,
} from '../shared/model';
import { normalizeSettings, normalizeState, stateAfterLaunch } from '../shared/normalize';
import * as Q from '../shared/queues';
import * as T from '../shared/tasks';
import { agentFor, effectiveTabState } from '../shared/agents';
import { AgentTracker } from './agentTracker';
import { currentHookStatus, installWithConfirm, removeWithConfirm, shortPath as claudeSettingsPath } from './hookInstaller';
import { HookServer, hookSocketPath } from './hookServer';
import {
  acceleratorFor,
  acceleratorFromInput,
  conflictFor,
  sameAccelerator,
  type RecordResult,
} from '../shared/shortcuts';
import { buildMenu, type MenuContext } from './menu';
import { dismissNotification, keepAwake, notify, setDockBadge } from './dock';
import { PtyManager, shellEnv, usableCwd } from './pty';
import { runSmokeTest } from './smoke';
import { JsonStore, readJson, readJsonObject, symlinkTarget, writeJsonSync } from './store';

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

/** Set if state.json couldn't be read at launch; shown once the window is up. */
let stateReadError: { aside: string; error: string } | undefined;
let state: AppState = stateAfterLaunch(
  readJson(stateFile, EMPTY_STATE, normalizeState, (aside, error) => (stateReadError = { aside, error })),
);
let settings: Settings = readSettingsFile() ?? DEFAULT_SETTINGS;
let win: BrowserWindow | undefined;
/** Esc and Ctrl-C, plain and in the kitty keyboard protocol's CSI-u form. */
const INTERRUPT_KEYS = new Set(['\x1b', '\x1b[27u', '\x03', '\x1b[99;5u']);

/** Whether the window's page has loaded and is listening for commands. */
let rendererReady = false;
/** Recent renderer crash times, to stop reloading a page that crashes as it loads. */
const crashes: number[] = [];
/** Lets the smoke test watch terminal output. */
let outputObserver: ((tabId: string, data: string) => void) | undefined;

const ptys = new PtyManager({
  data(tabId, data) {
    outputObserver?.(tabId, data);
    win?.webContents.send(IPC.ptyData, tabId, data);
  },
  exit(tabId, exit) {
    tracker.clear(tabId);
    win?.webContents.send(IPC.ptyExit, tabId, exit);
  },
});

const hookSocket = hookSocketPath(userData);
const tracker = new AgentTracker({
  shellPid: (tabId) => (ptys.has(tabId) ? ptys.pid(tabId) : undefined),
  onChange: () => {
    win?.webContents.send(IPC.agents, tracker.snapshot());
    setState(state); // agent state changed: re-file tasks
    updateDockAndPower();
  },
  onSession: (tabId, session) => {
    const found = T.findTab(state, tabId);
    if (!found) return;
    const saved = found.tab.claudeSession;
    if (saved?.id !== session?.id || saved?.cwd !== session?.cwd) {
      setState(T.updateTab(state, tabId, { claudeSession: session }));
    }
    // A new session in the tab replaces the one from before the restart.
    if (resumeOffers.delete(tabId)) sendResumeOffers();
  },
  // HUMANLOOP_HOOK_LOG=1 records every hook delivery, for checking how Claude Code behaves.
  logFile: process.env.HUMANLOOP_HOOK_LOG ? join(userData, 'hook-events.jsonl') : undefined,
});
const hookServer = new HookServer(hookSocket, (d) => tracker.handle(d));

/** Each task's agent state right now. */
function stateOf(): Q.AgentStateOf {
  return Q.agentStateOf(tracker.snapshot(), settings.policy);
}

/**
 * Claude sessions that were running in tabs when Humanloop last quit. Each tab
 * shows a Resume banner until you resume, dismiss, start another session in
 * it, or close it. Runtime only.
 */
const resumeOffers = new Map<string, ResumeOffer>();
for (const task of state.tasks) {
  for (const tab of task.tabs) {
    if (tab.claudeSession) resumeOffers.set(tab.id, { sessionId: tab.claudeSession.id, cwd: tab.claudeSession.cwd });
  }
}

function currentResumeOffers(): Record<string, ResumeOffer> {
  return Object.fromEntries([...resumeOffers].filter(([tabId]) => T.findTab(state, tabId)));
}

function sendResumeOffers(): void {
  win?.webContents.send(IPC.resume, currentResumeOffers());
}

/** Every update goes through here, so tasks are always filed by their current agent state. */
function setState(next: AppState): void {
  next = Q.reconcile(next, stateOf(), Date.now());
  if (next === state) return;
  const prev = state;
  state = next;
  stateStore.save(state);
  win?.webContents.send(IPC.state, state);
  updateMenuContext();
  updateDockAndPower();
  notifyArrivals(prev);
}

/** A notification for each task that came back to Your Turn while Humanloop was in the background. */
function notifyArrivals(prev: AppState): void {
  if (state.openTaskId && state.openTaskId !== prev.openTaskId) dismissNotification(state.openTaskId);
  if (!settings.notifications || BrowserWindow.getFocusedWindow()) return;
  const of = stateOf();
  for (const task of Q.arrivals(prev, state)) {
    const s = of(task);
    notify(task.id, task.title, s === 'needsYou' ? 'Claude needs you' : s === 'none' ? 'Claude exited' : 'Claude is done', () =>
      showTask(task.id),
    );
  }
}

/** Brings the window forward (opening one if needed) with the task open. */
function showTask(id: string): void {
  if (!win) win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (T.findTask(state, id)) setState(T.openTask(state, id, Date.now()));
}

/**
 * The Your Turn count on the Dock, and keep-awake while Claude is working in
 * any tab of any task (parked ones too). This looks at tabs, not task state:
 * under "Any tab done" a task can be your turn while another of its tabs works.
 */
function updateDockAndPower(): void {
  setDockBadge(T.tasksInQueue(state, 'yourTurn').length);
  const agents = tracker.snapshot();
  const working = state.tasks.some((task) => {
    const policy = effectivePolicy(settings.policy, task.policy);
    return task.tabs.some((tab) => {
      const agent = agentFor(agents, tab.id);
      return agent !== undefined && effectiveTabState(agent, policy) === 'working';
    });
  });
  keepAwake(settings.keepAwake && working);
}

/** Single-quotes a value for zsh. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ---------- settings ----------

function writeDefaultSettings(): void {
  // Shortcuts are left out: a command without an entry uses its default, so
  // later default changes still apply. Settings > Shortcuts lists them all.
  // Through a symlink that points at a file not there yet (a dotfiles repo not cloned yet), keeping the link.
  writeJsonSync(symlinkTarget(settingsFile), { ...settings, shortcuts: {} });
}

/**
 * An error message that doesn't block. (dialog.showErrorBox would stop the
 * main process, and with it terminal output and hook events, until dismissed.)
 */
function showError(message: string, detail: string): void {
  const opts: Electron.MessageBoxOptions = { type: 'error', message, detail };
  void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
}

function settingsFileError(error: string): void {
  showError("Couldn't save settings", `Humanloop's settings.json has an error, so it was left as is. Fix it and try again.\n\n${error}`);
}

/**
 * settings.json as it is on disk, or undefined if it is missing or can't be
 * parsed. A broken file is left where it is (you may be halfway through an
 * edit) and the last good settings stay in effect.
 */
function readSettingsFile(): Settings | undefined {
  const r = readJsonObject(settingsFile);
  if ('error' in r) {
    console.error(`Could not read ${settingsFile}: ${r.error}`);
    return undefined;
  }
  return r.value && normalizeSettings(r.value);
}


/**
 * Saves a settings screen change. Applies it to the file as it is on disk, so
 * hand edits the watcher hasn't picked up yet are kept. Refuses to touch a
 * file it can't parse.
 */
function updateSettings(patch: SettingsPatch): void {
  const r = readJsonObject(settingsFile);
  if ('error' in r) {
    settingsFileError(r.error);
    return;
  }
  // A missing file (never written, or deleted) starts from the defaults.
  const out = patchSettingsJson(r.value ?? {}, patch);
  try {
    // Through a symlink (e.g. into a dotfiles repo) to the file it points at, keeping the link.
    writeJsonSync(symlinkTarget(settingsFile), out);
  } catch (err) {
    showError("Couldn't save settings", String(err));
    return;
  }
  applySettings(normalizeSettings(out));
}

/** Puts new settings into effect: menu shortcuts, the renderer, and queue filing under the new policy. */
function applySettings(next: Settings): void {
  settings = next;
  installMenu();
  win?.webContents.send(IPC.settings, settings);
  setState(state);
  updateDockAndPower(); // keep-awake may have been switched, with no task moving
}

/**
 * Sets one command's shortcut, checking for a clash against settings.json as
 * it is on disk now, not the settings screen's copy, which can be a step behind.
 */
function setShortcut(id: CommandId, value: string | null, takeFrom?: CommandId): { conflict?: CommandId } {
  const r = readJsonObject(settingsFile);
  if ('error' in r) {
    settingsFileError(r.error);
    return {};
  }
  const current = r.value ? normalizeSettings(r.value) : DEFAULT_SETTINGS;
  const fallback = commandById(id).accelerator;
  const accelerator = value === null ? fallback : value;
  // A shortcut equal to the default is saved as "use the default", so later default changes still apply.
  const shortcuts: Record<string, string | null> = {
    [id]: accelerator && sameAccelerator(accelerator, fallback) ? null : accelerator,
  };
  if (accelerator) {
    const other = conflictFor(current, id, accelerator);
    if (other && other !== takeFrom) return { conflict: other };
    if (other) shortcuts[other] = '';
  }
  updateSettings({ shortcuts });
  return {};
}

/** Set while the settings screen is recording a shortcut: resolves with the key press. */
let recording: ((r: RecordResult | undefined) => void) | undefined;

function finishRecording(r: RecordResult | undefined): void {
  const done = recording;
  recording = undefined;
  done?.(r);
}

function watchSettings(): void {
  let timer: NodeJS.Timeout | undefined;
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = readSettingsFile();
      if (next) applySettings(next);
    }, 200);
  };
  // The folder is watched, not the file, so atomic saves (write a temp file,
  // rename it over) are seen. If settings.json is a symlink, the folder of the
  // file it points at is watched too.
  const target = symlinkTarget(settingsFile);
  const watched = new Map([[userData, 'settings.json']]);
  if (target !== settingsFile) watched.set(dirname(target), basename(target));
  for (const [dir, file] of watched) {
    try {
      watch(dir, (_event, name) => {
        if (name === file) reload();
      }).on('error', (err) => console.error(`Stopped watching ${dir}:`, err));
    } catch (err) {
      console.error(`Could not watch ${dir}:`, err);
    }
  }
}

let hookStatus = currentHookStatus();
/** The menu is built once the app is ready; until then there is nothing to update. */
let menuReady = false;
let menuContextKey = '';
/** Settings fills the window's main column: Back leaves it, and there is no Forward. */
let settingsShown = false;

function menuContext(): MenuContext {
  return {
    hooks: hookStatus,
    // Only parked and done change the menu, so Your Turn and Agent's Turn look
    // the same here: no rebuild (which can close an open menu) on every Claude turn.
    openQueue: ((q) => (q === 'agentsTurn' ? 'yourTurn' : q))(T.findTask(state, state.openTaskId)?.queue),
    canGoBack: settingsShown || Q.canGoBack(state),
    canGoForward: !settingsShown && Q.canGoForward(state),
    canGoNext: !settingsShown,
  };
}

function installMenu(): void {
  const ctx = menuContext();
  menuContextKey = JSON.stringify(ctx);
  Menu.setApplicationMenu(
    buildMenu(
      settings,
      {
        command: runCommand,
        copy: () => editCommand('copy'),
        selectAll: () => editCommand('selectAll'),
        openSettings: showSettings,
        installHooks: () => void installWithConfirm(win).then(refreshHookStatus),
        removeHooks: () => void removeWithConfirm(win).then(refreshHookStatus),
      },
      ctx,
    ),
  );
}

/** Settings was chosen while no window was open; the new window shows it once loaded. */
let settingsPending = false;
/** A menu command chosen while no window was open; the new window runs it once loaded. */
let commandPending: CommandId | undefined;

/**
 * Commands that still make sense once a closed window reopens: ones that
 * create or open something. Others (⌘W, ⌘K, tab switching) act on a tab you
 * can't see, so with no window they only bring it back.
 */
const COMMANDS_WITHOUT_WINDOW = new Set<CommandId>(['newTask', 'nextTask', 'back', 'forward']);

/** Sends a menu command to the window. The app keeps running without one; then the window opens first. */
function runCommand(id: CommandId): void {
  if (win && rendererReady) {
    win.webContents.send(IPC.command, id);
    return;
  }
  // A page still loading can't receive commands yet: it collects this one when it asks for its data.
  if (win) commandPending = id;
  else {
    commandPending = COMMANDS_WITHOUT_WINDOW.has(id) ? id : undefined;
    win = createWindow();
  }
  win.show();
}

function showSettings(): void {
  refreshHookStatus(); // ~/.claude/settings.json may have been edited by hand
  if (win && !rendererReady) {
    settingsPending = true; // the loading page picks it up with its data
    win.show();
  } else if (win) {
    win.webContents.send(IPC.showSettings);
    win.focus();
  } else {
    settingsPending = true;
    win = createWindow();
  }
}

function refreshHookStatus(): void {
  hookStatus = currentHookStatus();
  installMenu();
  win?.webContents.send(IPC.hooks, hookStatus);
}

/** Rebuilds the menu when its labels or enabled items would change. */
function updateMenuContext(): void {
  if (menuReady && JSON.stringify(menuContext()) !== menuContextKey) installMenu();
}

/** The renderer works out what Copy and Select All mean (a terminal, or the page) and calls back for the page. */
function editCommand(cmd: TerminalEditCommand): void {
  win?.webContents.send(TERMINAL_EDIT, cmd);
}

// ---------- tasks and tabs ----------

/** Where each new tab's shell starts, until it does. Runtime only: after a restart tabs start in the task's directory. */
const startDirs = new Map<string, string>();

/**
 * A new tab opens where you are: in the current tab's shell's directory
 * (wherever you last cd'd), from the system. Without a current tab it's the
 * task's default directory, then the global one, then home.
 */
async function newTab(taskId: string, fromTabId: string | undefined): Promise<string> {
  const from =
    settings.newTabsInCurrentDir && fromTabId && T.findTab(state, fromTabId)?.task.id === taskId ? fromTabId : undefined;
  const dir = from ? await ptys.cwd(from) : undefined;
  const id = randomUUID();
  if (!T.findTask(state, taskId)) throw new Error(`no task ${taskId}`);
  if (dir && usableCwd(dir) === dir) startDirs.set(id, dir);
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

/** Tabs where a program is running, not just the shell at its prompt. */
function busyTabs(tabIds: string[]): string[] {
  const busy = ptys.busyPrograms(tabIds);
  return tabIds.filter((id) => busy.has(id));
}

async function confirm(message: string, detail: string, action: string): Promise<boolean> {
  const opts = { type: 'warning' as const, message, detail, buttons: [action, 'Cancel'], defaultId: 0, cancelId: 1 };
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return response === 0;
}

/** Kills a tab's shell and forgets its agent. Call after the tab is gone from state. */
function killTab(tabId: string): void {
  ptys.kill(tabId);
  tracker.clear(tabId);
  resumeOffers.delete(tabId);
  startDirs.delete(tabId);
}

/** Offers to close the task's tabs, then marks it done. */
/** Moves a task to Done, like any other queue move: its tabs stay as they are. */
function markDone(id: string): void {
  setState(Q.markDone(state, id, Date.now()));
}

function park(id: string): void {
  if (T.findTask(state, id)) setState(Q.parkTask(state, id, Date.now()));
}

/** Unparks or reopens a task, filing it by its agent state. */
function restore(id: string): void {
  setState(Q.restoreTask(state, id, stateOf(), Date.now()));
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
  const closing = T.findTask(state, id)?.tabs ?? [];
  setState(T.deleteTask(state, id));
  for (const tab of closing) killTab(tab.id);
  return true;
}

function registerIpc(): void {
  ipcMain.handle(
    IPC.getInitialData,
    (): InitialData => {
      rendererReady = true;
      const show = settingsPending;
      const command = commandPending;
      settingsPending = false;
      commandPending = undefined;
      return {
        command,
        state,
        settings,
        homeDir: homedir(),
        agents: tracker.snapshot(),
        hooks: hookStatus,
        claudeSettingsPath: claudeSettingsPath(),
        showSettings: show,
        resume: currentResumeOffers(),
      };
    },
  );
  ipcMain.handle(IPC.recordShortcut, () => {
    finishRecording(undefined); // only one recording at a time
    return new Promise<RecordResult | undefined>((resolve) => {
      recording = resolve;
    });
  });
  ipcMain.on(IPC.stopRecording, () => finishRecording(undefined));
  ipcMain.handle(IPC.setShortcut, (_e, id: CommandId, value: string | null, takeFrom?: CommandId) => {
    const known = (c: unknown) => COMMAND_IDS.has(c as string);
    if (!known(id) || (value !== null && (typeof value !== 'string' || value.length > 100))) return {};
    return setShortcut(id, value, known(takeFrom) ? takeFrom : undefined);
  });
  ipcMain.handle(IPC.updateSettings, (_e, patch: SettingsPatch) => {
    if (typeof patch === 'object' && patch !== null && !Array.isArray(patch)) updateSettings(patch);
  });
  ipcMain.handle(IPC.resumeSession, (_e, tabId: string): string | undefined => {
    const offer = resumeOffers.get(tabId);
    if (!offer) return undefined;
    // The command is typed into the terminal, where control characters act
    // before the shell parses quotes, so a path containing them is refused.
    if (!/^[\w-]+$/.test(offer.sessionId) || /[\x00-\x1f\x7f]/.test(offer.cwd)) {
      return "This session's details look wrong, so Humanloop won't type them into your shell.";
    }
    if (!ptys.has(tabId)) return 'The shell in this tab has exited. Press Return in it to start a new one.';
    const program = ptys.busyProgram(tabId);
    if (program) return `${program} is running in this tab. Quit it first, then resume.`;
    resumeOffers.delete(tabId);
    sendResumeOffers();
    // Once you've typed in the tab, Ctrl-C first gives a fresh prompt whatever
    // the shell was doing: it drops a half-typed line, a continuation prompt
    // (after a trailing \), a `read` waiting for input, and vi command mode.
    // In an untouched new shell it's left out, since it would cut short your
    // startup files if they're still loading; the command waits as typeahead.
    const fresh = ptys.typedInto(tabId) ? '\x03' : '';
    const cd = offer.cwd ? `cd -- ${shellQuote(offer.cwd)} && ` : '';
    ptys.write(tabId, `${fresh}${cd}claude --resume ${offer.sessionId}\r`);
    return undefined;
  });
  ipcMain.on(IPC.dismissResume, (_e, tabId: string) => {
    if (!resumeOffers.delete(tabId)) return;
    sendResumeOffers();
    // Forget the old session, so the banner doesn't come back after the next restart.
    if (T.findTab(state, tabId)?.tab.claudeSession) setState(T.updateTab(state, tabId, { claudeSession: undefined }));
  });
  ipcMain.on(IPC.openSettingsFile, () => void shell.openPath(settingsFile));
  ipcMain.handle(IPC.installHooks, async () => {
    await installWithConfirm(win);
    refreshHookStatus();
  });
  ipcMain.handle(IPC.removeHooks, async () => {
    await removeWithConfirm(win);
    refreshHookStatus();
  });

  // Values from the renderer are checked here; the shared functions assume valid ids.
  ipcMain.handle(IPC.createTask, (_e, draft: unknown) =>
    createTask(typeof draft === 'object' && draft !== null ? (draft as TaskDraft) : ({} as TaskDraft)).taskId,
  );
  ipcMain.handle(IPC.updateTask, (_e, id: string, patch: Partial<TaskDraft>) => {
    if (T.findTask(state, id) && typeof patch === 'object' && patch !== null) setState(T.updateTask(state, id, patch));
  });
  ipcMain.handle(IPC.openTask, (_e, id: unknown) => {
    if (typeof id === 'string' && T.findTask(state, id)) setState(T.openTask(state, id, Date.now()));
  });
  ipcMain.handle(IPC.nextTask, () => {
    const r = Q.nextTask(state, stateOf(), Date.now());
    setState(r.state);
    return { nothingElse: r.nothingElse };
  });
  ipcMain.handle(IPC.goBack, () => setState(Q.goBack(state)));
  ipcMain.handle(IPC.goForward, () => setState(Q.goForward(state)));
  ipcMain.handle(IPC.toggleParked, () => {
    const task = T.findTask(state, state.openTaskId);
    if (task) (task.queue === 'parked' ? restore : park)(task.id);
  });
  ipcMain.handle(IPC.toggleDone, () => {
    const task = T.findTask(state, state.openTaskId);
    if (task?.queue === 'done') restore(task.id);
    else if (task) markDone(task.id);
  });
  ipcMain.on(IPC.openSettings, () => showSettings());
  ipcMain.on(IPC.settingsShown, (e, open: unknown) => {
    if (e.sender !== win?.webContents) return;
    settingsShown = open === true;
    updateMenuContext();
  });
  ipcMain.handle(IPC.deleteTask, (_e, id: unknown) => (typeof id === 'string' ? deleteTaskWithConfirm(id) : false));
  ipcMain.on(IPC.taskMenu, (_e, id: unknown, at: unknown) => {
    const task = typeof id === 'string' ? T.findTask(state, id) : undefined;
    if (!task) return;
    const parked = task.queue === 'parked';
    const done = task.queue === 'done';
    // The shortcuts act on the open task, so only its menu shows them (the menu bar handles the keys).
    const keys = (cmd: CommandId) =>
      task.id === state.openTaskId ? { accelerator: acceleratorFor(settings, cmd), registerAccelerator: false } : {};
    const pos = at as { x?: unknown; y?: unknown } | undefined;
    const where = typeof pos?.x === 'number' && typeof pos.y === 'number' ? { x: Math.round(pos.x), y: Math.round(pos.y) } : {};
    Menu.buildFromTemplate([
      { label: 'Edit Task…', ...keys('editTask'), click: () => win?.webContents.send(IPC.editTask, task.id) },
      { type: 'separator' },
      parked
        ? { label: 'Unpark Task', ...keys('parkTask'), click: () => restore(task.id) }
        : { label: 'Park Task', ...keys('parkTask'), click: () => park(task.id) },
      done
        ? { label: 'Reopen Task', ...keys('markDone'), click: () => restore(task.id) }
        : { label: 'Mark Done', ...keys('markDone'), click: () => markDone(task.id) },
      { type: 'separator' },
      { label: 'Delete Task…', click: () => void deleteTaskWithConfirm(task.id) },
    ]).popup({ window: win, ...where });
  });
  ipcMain.handle(IPC.chooseDirectory, async (_e, current?: string) => {
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: usableCwd(current),
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? undefined : res.filePaths[0];
  });

  ipcMain.handle(IPC.newTab, (_e, taskId: unknown, fromTabId: unknown) => {
    if (typeof taskId !== 'string') throw new Error('bad task id');
    return newTab(taskId, typeof fromTabId === 'string' ? fromTabId : undefined);
  });
  ipcMain.handle(IPC.closeTab, async (_e, tabId: string) => {
    const found = T.findTab(state, tabId);
    if (!found) return false;
    const program = ptys.busyProgram(tabId);
    if (program && !(await confirm('Close this tab?', `${program} is still running in it.`, 'Close Tab'))) {
      return false;
    }
    // The tab may have gone while the dialog was open.
    const task = T.findTab(state, tabId)?.task;
    if (task) setState(T.closeTab(state, task.id, tabId));
    killTab(tabId);
    return true;
  });

  ipcMain.handle(IPC.ptyAttach, (_e, tabId: string, cols: number, rows: number, restart: boolean) => {
    const found = T.findTab(state, tabId);
    if (!found) throw new Error(`no tab ${tabId}`);
    // Restarting replaces an exited shell; a live one (and its Claude) is left alone.
    if (restart === true && !ptys.has(tabId)) tracker.clear(tabId);
    return ptys.attach(tabId, {
      cols,
      rows,
      cwd: usableCwd(startDirs.get(tabId) ?? found.task.defaultCwd ?? settings.defaultCwd),
      env: shellEnv({
        HUMANLOOP_TAB: tabId,
        HUMANLOOP_SOCK: hookSocket,
        TERM_PROGRAM: 'Humanloop',
        TERM_PROGRAM_VERSION: app.getVersion(),
      }),
    }, restart === true);
  });
  ipcMain.on(IPC.ptyWrite, (_e, tabId: unknown, data: unknown) => {
    if (typeof tabId !== 'string' || typeof data !== 'string') return;
    // Esc and Ctrl-C both stop Claude's turn, and neither fires a hook. A lone
    // byte is the key itself (arrows and Option combos arrive as longer
    // sequences); the CSI-u forms are the same keys under the kitty keyboard protocol.
    if (INTERRUPT_KEYS.has(data)) tracker.interrupt(tabId);
    ptys.write(tabId, data);
  });
  ipcMain.on(IPC.ptyWriteBinary, (_e, tabId: unknown, data: unknown) => {
    if (typeof tabId === 'string' && typeof data === 'string') ptys.writeBytes(tabId, Buffer.from(data, 'latin1'));
  });
  ipcMain.on(IPC.ptyResize, (_e, tabId: unknown, cols: unknown, rows: unknown) => {
    if (typeof tabId === 'string' && typeof cols === 'number' && typeof rows === 'number') ptys.resize(tabId, cols, rows);
  });
  ipcMain.on(IPC.ptyAck, (_e, tabId: unknown, chars: unknown) => {
    if (typeof tabId === 'string' && typeof chars === 'number') ptys.ack(tabId, chars);
  });
  // The page is unloading (a reload): its terminals are going away, and tabs
  // re-attach as the new page shows them. This comes from the page itself
  // rather than a navigation event, because a navigation the window blocks
  // (say, a file dropped on it) also starts one, and must not detach anything.
  ipcMain.on(IPC.unload, (e) => {
    if (e.sender !== win?.webContents) return;
    ptys.detachAll();
    finishRecording(undefined);
    rendererReady = false;
    settingsShown = false;
  });
  ipcMain.on(IPC.pageEdit, (_e, cmd: TerminalEditCommand) => {
    if (cmd === 'copy') win?.webContents.copy();
    else if (cmd === 'selectAll') win?.webContents.selectAll();
  });
  ipcMain.on(IPC.clipboard, (_e, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });
}

// ---------- window ----------

/** The page's background (--bg-window) in the current appearance. */
function windowColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#111113' : '#F5F5F7';
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 420,
    show: false,
    title: 'Humanloop',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 13, y: 16 },
    backgroundColor: windowColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      // Terminals acknowledge output as they draw it; a throttled hidden or
      // minimized window would fall behind and pause busy shells.
      backgroundThrottling: false,
    },
  });
  // Matches the page, so a live resize never flashes the other appearance's colour.
  const onTheme = () => w.setBackgroundColor(windowColor());
  nativeTheme.on('updated', onTheme);
  w.on('closed', () => nativeTheme.off('updated', onTheme));
  w.once('ready-to-show', () => {
    // The smoke test shows the window without taking focus, so fonts are
    // measured on a real screen just like a normal launch.
    if (process.env.HUMANLOOP_SMOKE) w.showInactive();
    else w.show();
  });
  // Switching to another app ends a recording, rather than leaving it waiting.
  w.on('blur', () => finishRecording(undefined));
  w.on('closed', () => {
    if (win === w) win = undefined;
    finishRecording(undefined);
    rendererReady = false;
    settingsShown = false;
    ptys.detachAll();
  });

  // A crashed renderer acknowledges nothing, which would leave every shell
  // paused behind a blank window: detach the shells and load a fresh page.
  w.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer gone:', details.reason);
    ptys.detachAll();
    finishRecording(undefined);
    rendererReady = false;
    settingsShown = false;
    if (details.reason === 'clean-exit' || w.isDestroyed()) return;
    // Reload, unless the page keeps crashing as it loads.
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && crashes[0]! < now - 60_000) crashes.shift();
    if (crashes.length <= 3) {
      w.reload();
      return;
    }
    showError(
      'Humanloop keeps crashing',
      `Its window crashed ${crashes.length} times in the last minute (${details.reason}), so it wasn't reloaded again. Your shells are still running; use View > Reload or reopen the window to try again.`,
    );
  });
  // While recording a shortcut, the key press goes to the recorder instead of the menu or page.
  w.webContents.on('before-input-event', (e, input) => {
    if (!recording || input.type !== 'keyDown') return;
    e.preventDefault();
    if (input.key === 'Escape') return finishRecording(undefined);
    const r = acceleratorFromInput(input);
    if (r) finishRecording(r);
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
      // Quitting now would lose what couldn't be saved (a full disk, say): say so first.
      if (
        !(await stateStore.flush()) &&
        !(await confirm(
          "Your tasks couldn't be saved",
          `Humanloop couldn't write ${stateFile}. If you quit now, changes since the last save are lost.`,
          'Quit Anyway',
        ))
      ) {
        return;
      }
      hookServer.stop(); // sessions ending now shouldn't clear their resume records
      // Give shells and their programs a moment to exit, then make sure they have.
      await ptys.shutdown();
      readyToQuit = true;
      app.quit();
    } finally {
      quitting = false;
    }
  })();
});

app.on('will-quit', () => {
  hookServer.stop();
  try {
    stateStore.flushSync();
  } catch (err) {
    console.error('Could not save state on quit:', err);
  }
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
    showError(
      "Humanloop can't track Claude",
      `Humanloop could not open its hook socket at ${hookSocket}, so it won't see what Claude is doing in its tabs. Terminals still work.\n\n${String(err)}`,
    );
  }
  if (!existsSync(settingsFile)) writeDefaultSettings();
  watchSettings();
  menuReady = true;
  installMenu();
  registerIpc();
  win = createWindow();
  if (stateReadError) {
    showError(
      "Humanloop couldn't read your saved tasks",
      `It started with no tasks. The file was kept as ${stateReadError.aside.replace(homedir(), '~')}.\n\n${stateReadError.error}`,
    );
  }
  setState(state); // no-op unless launch reconciliation changed something
  stateStore.save(state);
  updateDockAndPower();

  if (process.env.HUMANLOOP_SMOKE) {
    void runSmokeTest({
      win,
      createTaskAndTab: () => createTask({ title: 'Smoke test', description: '', priority: 2 }),
      writeToTab: (tabId, data) => ptys.write(tabId, data),
      observeOutput: (fn) => {
        outputObserver = fn;
      },
    });
  }
});
