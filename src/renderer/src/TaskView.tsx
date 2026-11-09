import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { commandById, type CommandId } from '../../shared/commands';
import { effectiveTabState, type TabAgent } from '../../shared/agents';
import { effectivePolicy, type Settings, type Task } from '../../shared/model';
import { AgentDot } from './AgentDot';
import { formatAccelerator, shortenHome } from './format';
import { terminals } from './terminals';

interface Props {
  task: Task;
  activeTabId: string | undefined;
  settings: Settings;
  homeDir: string;
  agents: Record<string, TabAgent>;
  onSelectTab(tabId: string): void;
  onCloseTab(tabId: string): void;
  onNewTab(): void;
  onEdit(): void;
  focusTerminal: boolean;
}

export function TaskView({ task, activeTabId, settings, homeDir, agents, onSelectTab, onCloseTab, onNewTab, onEdit, focusTerminal }: Props) {
  // Terminal titles (set by programs like Claude Code) live outside React.
  useSyncExternalStore(terminals.subscribe, terminals.getVersion);
  const key = (id: CommandId) => formatAccelerator(settings.shortcuts[id] ?? commandById(id).accelerator);
  const cwd = shortenHome(task.defaultCwd ?? settings.defaultCwd, homeDir) ?? '~';

  return (
    <div className="task-view">
      <header className="task-header">
        <div className="task-heading">
          <span className={`priority p${task.priority}`}>P{task.priority}</span>
          <h1>{task.title}</h1>
          <span className="task-cwd" title="New tabs open here">
            {cwd}
          </span>
          <button className="ghost" onClick={onEdit} title={`Edit task (${key('editTask')})`}>
            Edit
          </button>
        </div>
        {task.description && <p className="task-description">{task.description}</p>}
      </header>

      <div className="tab-bar" role="tablist">
        {task.tabs.map((tab, i) => {
          const title = terminals.peek(tab.id)?.title || tab.title;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTabId}
              className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
              onMouseDown={(e) => {
                if (e.button === 0) onSelectTab(tab.id);
              }}
              onAuxClick={(e) => {
                if (e.button === 1) onCloseTab(tab.id);
              }}
              title={title}
            >
              {agents[tab.id] && (
                <AgentDot state={effectiveTabState(agents[tab.id]!, effectivePolicy(settings.policy, task.policy))} />
              )}
              <span className="tab-title">{title}</span>
              {i < 9 && <span className="tab-key">⌘{i + 1}</span>}
              <button
                className="tab-close"
                aria-label="Close tab"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onCloseTab(tab.id)}
              >
                ×
              </button>
            </div>
          );
        })}
        <button className="tab-new" onClick={onNewTab} title={`New tab (${key('newTab')})`}>
          +
        </button>
      </div>

      {activeTabId ? (
        <TerminalPane key={activeTabId} tabId={activeTabId} focus={focusTerminal} />
      ) : (
        <div className="empty-main">
          <p>This task has no tabs.</p>
          <button className="primary" onClick={onNewTab}>
            New Tab <kbd>{key('newTab')}</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

function TerminalPane({ tabId, focus }: { tabId: string; focus: boolean }) {
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const h = terminals.get(tabId);
    h.show(host.current!);
    return () => h.hide();
  }, [tabId]);

  useEffect(() => {
    if (focus) terminals.peek(tabId)?.focus();
  }, [tabId, focus]);

  return <div className="terminal-host" ref={host} />;
}
