import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandId } from '../../shared/commands';
import type { AppState, Settings, Task } from '../../shared/model';
import { findTask } from '../../shared/tasks';
import { Sidebar } from './Sidebar';
import { TaskEditor, type EditorMode } from './TaskEditor';
import { TaskView } from './TaskView';
import { terminals } from './terminals';

const api = window.humanloop;

interface Loaded {
  state: AppState;
  settings: Settings;
  homeDir: string;
}

/** The selected tab of a task, falling back to its first tab. */
function selectedTab(task: Task | undefined, chosen: Record<string, string>): string | undefined {
  if (!task) return undefined;
  const id = chosen[task.id];
  return id && task.tabs.some((t) => t.id === id) ? id : task.tabs[0]?.id;
}

export function App() {
  const [data, setData] = useState<Loaded>();
  const [chosenTab, setChosenTab] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<EditorMode>();

  useEffect(() => {
    let alive = true;
    void api.getInitialData().then((d) => alive && setData(d));
    const offState = api.onState((state) => setData((d) => d && { ...d, state }));
    const offSettings = api.onSettings((settings) => setData((d) => d && { ...d, settings }));
    return () => {
      alive = false;
      offState();
      offSettings();
    };
  }, []);

  const state = data?.state;
  const openTask = state ? findTask(state, state.openTaskId) : undefined;
  const activeTabId = selectedTab(openTask, chosenTab);

  // Drop terminals for tabs that were closed or deleted.
  useEffect(() => {
    if (state) terminals.prune(new Set(state.tasks.flatMap((t) => t.tabs.map((tab) => tab.id))));
  }, [state]);

  const selectTab = useCallback((taskId: string, tabId: string) => {
    setChosenTab((c) => ({ ...c, [taskId]: tabId }));
  }, []);

  const newTab = useCallback(
    async (kind: 'shell' | 'claude') => {
      if (!openTask) return;
      const id = await api.newTab(openTask.id, kind);
      selectTab(openTask.id, id);
    },
    [openTask, selectTab],
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      if (!openTask) return;
      const i = openTask.tabs.findIndex((t) => t.id === tabId);
      const closed = await api.closeTab(tabId);
      if (closed && tabId === activeTabId) {
        // Select the tab that slides into its place, like a browser.
        const rest = openTask.tabs.filter((t) => t.id !== tabId);
        const next = rest[Math.min(i, rest.length - 1)];
        if (next) selectTab(openTask.id, next.id);
      }
    },
    [openTask, activeTabId, selectTab],
  );

  // Menu commands. A ref keeps the handler current without re-subscribing.
  const commandRef = useRef<(id: CommandId) => void>(() => {});
  commandRef.current = (id) => {
    if (editor) return;
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
        void newTab('shell');
        return;
      case 'newClaudeTab':
        void newTab('claude');
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
      default: {
        // tab1 … tab9; tab9 always means the last tab.
        const n = Number(id.slice(3));
        const tab = n === 9 ? tabs.at(-1) : tabs[n - 1];
        if (openTask && tab) selectTab(openTask.id, tab.id);
      }
    }
  };
  useEffect(() => api.onCommand((id) => commandRef.current(id)), []);

  const onTaskMenu = useCallback(async (task: Task) => {
    const choice = await api.showTaskMenu(task.id);
    if (choice === 'edit') setEditor({ kind: 'edit', task });
    if (choice === 'delete') await api.deleteTask(task.id);
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(undefined);
    if (activeTabId) requestAnimationFrame(() => terminals.peek(activeTabId)?.focus());
  }, [activeTabId]);

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
        onSelectTab={(tabId) => selectTab(openTask.id, tabId)}
        onCloseTab={closeTab}
        onNewTab={newTab}
        onEdit={() => setEditor({ kind: 'edit', task: openTask })}
        focusTerminal={!editor}
      />
    );
  }, [state, data, openTask, activeTabId, selectTab, closeTab, newTab, editor]);

  if (!data || !state) return null;

  return (
    <div className="app">
      <Sidebar
        state={state}
        settings={data.settings}
        onOpen={(id) => void api.openTask(id)}
        onEdit={(task) => setEditor({ kind: 'edit', task })}
        onMenu={onTaskMenu}
        onNew={() => setEditor({ kind: 'create' })}
      />
      <main className="main">{view}</main>
      {editor && (
        <TaskEditor
          mode={editor}
          homeDir={data.homeDir}
          globalDefaultCwd={data.settings.defaultCwd}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}
