import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandId } from '../../shared/commands';
import type { TabAgent } from '../../shared/agents';
import type { HookState, ResumeOffer } from '../../shared/ipc';
import type { AppState, Settings, Task } from '../../shared/model';
import { acceleratorFor, sameAccelerator } from '../../shared/shortcuts';
import { findTask, tasksInQueue } from '../../shared/tasks';
import { formatAccelerator, tip } from './format';
import { ChevronDownIcon, NewTaskIcon, SettingsIcon } from './icons';
import { SettingsView } from './SettingsView';
import { Sidebar } from './Sidebar';
import { TruncationTooltip } from './Tooltip';
import { TaskEditor, type EditorMode } from './TaskEditor';
import { TaskView } from './TaskView';
import { setOptionAsMeta, terminals } from './terminals';

const api = window.humanloop;

interface Loaded {
  state: AppState;
  settings: Settings;
  homeDir: string;
  agents: Record<string, TabAgent>;
  hooks: HookState;
  claudeSettingsPath: string;
  resume: Record<string, ResumeOffer>;
}

/**
 * The selected tab of a task. When it's gone (closed, or its shell exited),
 * the tab that slid into its place, like a browser; else the first.
 * `lastIndex` remembers where each task's selected tab was.
 */
function selectedTab(task: Task | undefined, chosen: Record<string, string>, lastIndex: Record<string, number>): string | undefined {
  if (!task) return undefined;
  const i = task.tabs.findIndex((t) => t.id === chosen[task.id]);
  if (i >= 0) {
    lastIndex[task.id] = i;
    return task.tabs[i]!.id;
  }
  return task.tabs[Math.min(lastIndex[task.id] ?? 0, task.tabs.length - 1)]?.id;
}

export function App() {
  const [data, setData] = useState<Loaded>();
  const [chosenTab, setChosenTab] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<EditorMode>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** A menu command chosen while no window was open, run once the data has loaded. */
  const [pendingCommand, setPendingCommand] = useState<CommandId>();
  const [find, setFind] = useState<{ query: string; focusSignal: number }>();
  /** Bumped each time Next task finds nothing else, so the notice restarts. */
  const [nothingElse, setNothingElse] = useState(0);
  const clearNotice = useCallback(() => setNothingElse(0), []);
  const submitEditor = useRef<() => void>(undefined);
  /** Saves Settings' unconfirmed directory field before it closes. */
  const flushSettings = useRef<() => void>(undefined);

  useEffect(() => {
    let alive = true;
    // IPC keeps order and main answers getInitialData in one go, so the
    // snapshot is newer than any update that arrived before it: updates only
    // apply once it's here.
    const offState = api.onState((state) => setData((d) => d && { ...d, state }));
    const offSettings = api.onSettings((settings) => setData((d) => d && { ...d, settings }));
    const offAgents = api.onAgents((agents) => setData((d) => d && { ...d, agents }));
    const offHooks = api.onHooks((hooks) => setData((d) => d && { ...d, hooks }));
    const offResume = api.onResume((resume) => setData((d) => d && { ...d, resume }));
    void api.getInitialData().then((d) => {
      if (!alive) return;
      if (d.showSettings) setSettingsOpen(true);
      setData(d);
      if (d.command) setPendingCommand(d.command);
    });
    return () => {
      alive = false;
      offState();
      offSettings();
      offAgents();
      offHooks();
      offResume();
    };
  }, []);

  const state = data?.state;
  const openTask = state ? findTask(state, state.openTaskId) : undefined;
  const lastTabIndex = useRef<Record<string, number>>({});
  const activeTabId = selectedTab(openTask, chosenTab, lastTabIndex.current);

  const optionAsMeta = data?.settings.optionAsMeta;
  useEffect(() => {
    if (optionAsMeta !== undefined) setOptionAsMeta(optionAsMeta);
  }, [optionAsMeta]);

  // Drop terminals for tabs that were closed or deleted.
  useEffect(() => {
    if (state) terminals.prune(new Set(state.tasks.flatMap((t) => t.tabs.map((tab) => tab.id))));
  }, [state]);

  const selectTab = useCallback((taskId: string, tabId: string) => {
    setChosenTab((c) => ({ ...c, [taskId]: tabId }));
  }, []);

  const newTab = useCallback(
    async () => {
      if (!openTask) return;
      const id = await api.newTab(openTask.id, activeTabId);
      selectTab(openTask.id, id);
    },
    [openTask, activeTabId, selectTab],
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      if (!openTask) return;
      const i = openTask.tabs.findIndex((t) => t.id === tabId);
      const closed = await api.closeTab(tabId);
      if (closed && tabId === activeTabId) {
        // Select the tab that slides into its place, like a browser. The tabs
        // may have changed while a confirmation was open, so use the latest.
        const latest = stateRef.current && findTask(stateRef.current, openTask.id);
        const rest = (latest?.tabs ?? openTask.tabs).filter((t) => t.id !== tabId);
        const next = rest[Math.min(i, rest.length - 1)];
        if (next) selectTab(openTask.id, next.id);
      }
    },
    [openTask, activeTabId, selectTab],
  );

  // Menu commands. A ref keeps the handler current without re-subscribing.
  const commandRef = useRef<(id: CommandId) => void>(() => {});
  commandRef.current = (id) => {
    if (editor) {
      // ⌘Return is the editor's Save, and the menu may take that key before
      // the form sees it: whichever command it is bound to then saves.
      const accel = data && acceleratorFor(data.settings, id);
      if (accel && sameAccelerator(accel, 'CmdOrCtrl+Return')) submitEditor.current?.();
      return;
    }
    if (settingsOpen) {
      // Settings fills the main column: the tab and terminal commands have
      // nothing to act on, and Back just leaves it for the task it covered.
      if (id === 'back' || id === 'forward') {
        if (id === 'back') closeSettings();
        return;
      } else if (!['newTask', 'editTask', 'nextTask', 'parkTask', 'markDone'].includes(id)) return;
    }
    const tabs = openTask?.tabs ?? [];
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    switch (id) {
      case 'newTask':
        setEditor({ kind: 'create' });
        return;
      case 'editTask':
        if (openTask) setEditor({ kind: 'edit', task: openTask });
        return;
      case 'newTab':
        void newTab();
        return;
      case 'closeTab':
        if (activeTabId) void closeTab(activeTabId);
        return;
      case 'nextTab':
      case 'prevTab': {
        if (!openTask || tabs.length < 2) return;
        const step = id === 'nextTab' ? 1 : -1;
        selectTab(openTask.id, tabs[(idx + step + tabs.length) % tabs.length]!.id);
        return;
      }
      case 'clearTerminal':
        if (activeTabId) terminals.peek(activeTabId)?.term.clear();
        return;
      case 'find':
        if (activeTabId) setFind((f) => ({ query: f?.query ?? '', focusSignal: (f?.focusSignal ?? 0) + 1 }));
        return;
      case 'findNext':
      case 'findPrevious':
        if (!activeTabId) return;
        if (find?.query) terminals.peek(activeTabId)?.find(find.query, id === 'findNext' ? 'next' : 'previous');
        else setFind((f) => ({ query: f?.query ?? '', focusSignal: (f?.focusSignal ?? 0) + 1 }));
        return;
      case 'nextTask':
        void api.nextTask().then((r) => {
          if (r.nothingElse) setNothingElse((n) => n + 1);
          else if (settingsOpen) closeSettings();
        });
        return;
      case 'back':
        void api.goBack();
        return;
      case 'forward':
        void api.goForward();
        return;
      case 'parkTask':
        void api.toggleParked();
        return;
      case 'markDone':
        void api.toggleDone();
        return;
      default: {
        // tab1 … tab9; tab9 always means the last tab.
        const n = Number(id.slice(3));
        const tab = n === 9 ? tabs.at(-1) : tabs[n - 1];
        if (openTask && tab) selectTab(openTask.id, tab.id);
      }
    }
  };
  useEffect(() => api.onCommand((id) => commandRef.current(id)), []);
  useEffect(() => {
    if (!data || !pendingCommand) return;
    commandRef.current(pendingCommand);
    setPendingCommand(undefined);
  }, [data, pendingCommand]);
  useEffect(
    () =>
      // Not while the task editor is open: it is modal, and Settings would open out of sight behind it.
      api.onShowSettings(() => {
        if (!editorRef.current) setSettingsOpen(true);
      }),
    [],
  );
  useEffect(() => {
    // Lets UI tests run menu commands, whose native shortcuts can't be pressed from a script.
    window.__humanloopDebug = {
      ...window.__humanloopDebug!,
      command: (id) => commandRef.current(id),
      showSettings: () => setSettingsOpen(true),
    };
  }, []);

  const onTaskMenu = useCallback((task: Task) => api.showTaskMenu(task.id), []);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  // The menu's Back and Forward follow Settings (Back closes it).
  useEffect(() => api.settingsShown(settingsOpen), [settingsOpen]);
  // A shortcut being recorded in Settings would take the editor's key presses.
  useEffect(() => {
    if (editor) api.stopRecording();
  }, [editor]);

  // The task menu's Edit item. A ref reads the current state without re-subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(
    () =>
      api.onEditTask((id) => {
        const task = stateRef.current && findTask(stateRef.current, id);
        if (task) setEditor({ kind: 'edit', task });
      }),
    [],
  );

  /** Where typing goes once a dialog closes: the find bar if it's open, else the terminal. */
  const refocus = useCallback(() => {
    requestAnimationFrame(() => {
      const find = document.querySelector<HTMLInputElement>('.find-bar input');
      if (find) find.focus();
      else if (activeTabId) terminals.peek(activeTabId)?.focus();
    });
  }, [activeTabId]);
  /** A task created from Settings is opened, so Settings makes way for it. */
  function closeEditor(created?: boolean) {
    setEditor(undefined);
    if (created && settingsOpen) closeSettings();
    else refocus();
  }
  const closeFind = useCallback(() => {
    setFind(undefined);
    if (activeTabId) requestAnimationFrame(() => terminals.peek(activeTabId)?.focus());
  }, [activeTabId]);
  function closeSettings() {
    flushSettings.current?.();
    setSettingsOpen(false);
    refocus();
  }
  const closeSettingsRef = useRef(closeSettings);
  closeSettingsRef.current = closeSettings;
  // Esc closes Settings (a shortcut being recorded takes Esc first, in main).
  useEffect(() => {
    if (!settingsOpen || editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        closeSettingsRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, editor]);

  const view = useMemo(() => {
    if (!state || !data) return null;
    if (!openTask) {
      const newTaskKey = formatAccelerator(acceleratorFor(data.settings, 'newTask'));
      return state.tasks.length === 0 ? (
        <div className="empty-main">
          <h2>No tasks yet</h2>
          <button className="btn primary big" onClick={() => setEditor({ kind: 'create' })}>
            New task {newTaskKey && <span className="k">{newTaskKey}</span>}
          </button>
        </div>
      ) : (
        <div className="empty-main">
          <h2>Pick a task from the sidebar</h2>
        </div>
      );
    }
    return (
      <TaskView
        task={openTask}
        activeTabId={activeTabId}
        settings={data.settings}
        homeDir={data.homeDir}
        agents={data.agents}
        onSelectTab={(tabId) => selectTab(openTask.id, tabId)}
        onCloseTab={closeTab}
        onNewTab={newTab}
        focusTerminal={!editor}
        resume={data.resume}
        find={find}
        onFindQuery={(query) => setFind((f) => f && { ...f, query })}
        onCloseFind={closeFind}
      />
    );
  }, [state, data, openTask, activeTabId, selectTab, closeTab, newTab, editor, find, closeFind]);

  if (!data || !state) return null;
  const key = (id: CommandId) => formatAccelerator(acceleratorFor(data.settings, id));
  // The task ⌘↩ would open: what queues.ts nextTask picks.
  const nextUp = tasksInQueue(state, 'yourTurn').find((t) => t.id !== state.openTaskId);
  const withClaude = tasksInQueue(state, 'agentsTurn').filter((t) => t.id !== state.openTaskId).length;

  return (
    <div className="app">
      <Sidebar
        inert={!!editor}
        state={state}
        settings={data.settings}
        agents={data.agents}
        resume={data.resume}
        onOpen={(id) => {
          if (settingsOpen) closeSettings();
          void api.openTask(id);
        }}
        onEdit={(task) => setEditor({ kind: 'edit', task })}
        onMenu={onTaskMenu}
        settingsOpen={settingsOpen}
        onBack={() => commandRef.current('back')}
        onForward={() => commandRef.current('forward')}
      />
      <main className="main" inert={!!editor}>
        <header className="main-header">
          {/* The bar's empty space drags the window; the title and controls opt out. */}
          {settingsOpen ? (
            <h1 className="settings-title">Settings</h1>
          ) : openTask ? (
            <TaskTitle task={openTask} />
          ) : (
            <span className="spacer" />
          )}
          <div className="header-controls">
            {!settingsOpen && (
              <>
                <button className="ib" onClick={() => setEditor({ kind: 'create' })} title={tip('New task', key('newTask'))} aria-label="New task">
                  <NewTaskIcon />
                </button>
                <button className="ib" onClick={() => api.openSettings()} title={tip('Settings', '⌘,')} aria-label="Settings">
                  <SettingsIcon />
                </button>
              </>
            )}
            <button
              className={`btn next ${nextUp ? 'primary' : 'quiet'}`}
              disabled={state.tasks.length === 0}
              onClick={() => commandRef.current('nextTask')}
              title={nextUp ? `Open ${nextUp.title}` : 'Nothing else needs you'}
            >
              <span className={nextUp ? 'next-word' : ''}>Next</span>
              {nextUp && <span className="next-title">{nextUp.title}</span>}
              {key('nextTask') && <span className="k">{key('nextTask')}</span>}
            </button>
            {settingsOpen && (
              <button className="btn" onClick={closeSettings}>
                Close <span className="k">esc</span>
              </button>
            )}
          </div>
          {nothingElse > 0 && (
            <Popover key={nothingElse} onDone={clearNotice}>
              <strong>Nothing else needs you</strong>
              {withClaude > 0 && (
                <span>{withClaude === 1 ? '1 other task is with Claude.' : `${withClaude} other tasks are with Claude.`}</span>
              )}
            </Popover>
          )}
        </header>
        {settingsOpen ? (
          <SettingsView
            settings={data.settings}
            hooks={data.hooks}
            claudeSettingsPath={data.claudeSettingsPath}
            homeDir={data.homeDir}
            flushRef={flushSettings}
          />
        ) : (
          view
        )}
      </main>
      {editor && (
        <TaskEditor
          key={editor.kind === 'edit' ? editor.task.id : 'new'}
          mode={editor}
          globalPolicy={data.settings.policy}
          onClose={closeEditor}
          submitRef={submitEditor}
        />
      )}
      <TruncationTooltip />
    </div>
  );
}

/**
 * The open task's title, with the full text in a tooltip when it is cut off,
 * and a ⌄ button for the task's menu (Edit, Park, Mark done, Delete).
 */
function TaskTitle({ task }: { task: Task }) {
  return (
    <h1 className="task-name">
      <span data-tip={task.title} data-tip-width="560">
        {task.title}
      </span>
      <button
        className="ib task-menu"
        aria-label="Task actions"
        title="Task actions"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          api.showTaskMenu(task.id, { x: r.left, y: r.bottom + 4 });
        }}
      >
        <ChevronDownIcon />
      </button>
    </h1>
  );
}

/** Says why Next did nothing, under the button, and fades out on its own. */
function Popover({ children, onDone }: { children: React.ReactNode; onDone(): void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="popover" role="status">
      {children}
    </div>
  );
}
