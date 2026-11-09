import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandId } from '../../shared/commands';
import type { TabAgent } from '../../shared/agents';
import type { HookState, ResumeOffer } from '../../shared/ipc';
import type { AppState, Settings, Task } from '../../shared/model';
import { acceleratorFor, sameAccelerator } from '../../shared/shortcuts';
import { findTask } from '../../shared/tasks';
import { SettingsView } from './SettingsView';
import { Sidebar } from './Sidebar';
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

/** The selected tab of a task, falling back to its first tab. */
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
    if (settingsOpen) return;
    if (editor) {
      // ⌘Return is the editor's Save, and the menu may take that key before
      // the form sees it: whichever command it is bound to then saves.
      const accel = data && acceleratorFor(data.settings, id);
      if (accel && sameAccelerator(accel, 'CmdOrCtrl+Return')) submitEditor.current?.();
      return;
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
      // Opens over the task editor, if one is open, so its unsaved draft is kept.
      api.onShowSettings(() => setSettingsOpen(true)),
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
  const closeEditor = useCallback(() => {
    setEditor(undefined);
    refocus();
  }, [refocus]);
  const closeFind = useCallback(() => {
    setFind(undefined);
    if (activeTabId) requestAnimationFrame(() => terminals.peek(activeTabId)?.focus());
  }, [activeTabId]);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    // Back to the editor if Settings opened over it.
    if (editor) requestAnimationFrame(() => document.querySelector<HTMLElement>('.modal input')?.focus());
    else refocus();
  }, [editor, refocus]);

  const view = useMemo(() => {
    if (!state || !data) return null;
    if (!openTask) {
      return (
        <div className="empty-main titlebar-pad">
          {state.tasks.length === 0 ? (
            <>
              <h2>No tasks yet</h2>
              <p>A task groups the terminal tabs you use for one piece of work.</p>
            </>
          ) : (
            <p>Pick a task from the sidebar.</p>
          )}
          <button className="primary" onClick={() => setEditor({ kind: 'create' })}>
            New Task
          </button>
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
        onEdit={() => setEditor({ kind: 'edit', task: openTask })}
        focusTerminal={!editor && !settingsOpen}
        resume={data.resume}
        find={find}
        onFindQuery={(query) => setFind((f) => f && { ...f, query })}
        onCloseFind={closeFind}
      />
    );
  }, [state, data, openTask, activeTabId, selectTab, closeTab, newTab, editor, settingsOpen, find, closeFind]);

  if (!data || !state) return null;
  // While a dialog is open, everything behind it is inert: no focus, clicks or typing reach it.
  const modalOpen = !!editor || settingsOpen;

  return (
    <div className="app">
      <Sidebar
        inert={modalOpen}
        state={state}
        settings={data.settings}
        agents={data.agents}
        onOpen={(id) => void api.openTask(id)}
        onEdit={(task) => setEditor({ kind: 'edit', task })}
        onMenu={onTaskMenu}
        onNew={() => setEditor({ kind: 'create' })}
      />
      <main className="main" inert={modalOpen}>
        {view}
        {nothingElse > 0 && <Notice key={nothingElse} text="Nothing else needs you" onDone={clearNotice} />}
      </main>
      {editor && (
        <TaskEditor
          key={editor.kind === 'edit' ? editor.task.id : 'new'}
          inert={settingsOpen}
          mode={editor}
          homeDir={data.homeDir}
          globalDefaultCwd={data.settings.defaultCwd}
          globalPolicy={data.settings.policy}
          onClose={closeEditor}
          submitRef={submitEditor}
        />
      )}
      {settingsOpen && (
        <SettingsView
          settings={data.settings}
          hooks={data.hooks}
          claudeSettingsPath={data.claudeSettingsPath}
          homeDir={data.homeDir}
          onClose={closeSettings}
        />
      )}
    </div>
  );
}

/** A short message that fades out on its own. */
function Notice({ text, onDone }: { text: string; onDone(): void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="notice" role="status">
      {text}
    </div>
  );
}
