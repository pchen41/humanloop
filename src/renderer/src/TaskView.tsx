import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CommandId } from '../../shared/commands';
import { acceleratorFor } from '../../shared/shortcuts';
import { agentFor, effectiveTabState, type TabAgent } from '../../shared/agents';
import { effectivePolicy, type Settings, type Task } from '../../shared/model';
import type { ResumeOffer } from '../../shared/ipc';
import { AgentDot, backgroundSummary } from './AgentDot';
import { FindBar } from './FindBar';
import { formatAccelerator, shellQuote, shortenHome } from './format';
import { terminals } from './terminals';

const api = window.humanloop;

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
  resume: Record<string, ResumeOffer>;
  /** The find bar, when open. */
  find: { query: string; focusSignal: number } | undefined;
  onFindQuery(query: string): void;
  onCloseFind(): void;
}

export function TaskView(props: Props) {
  const { task, activeTabId, settings, homeDir, agents, onSelectTab, onCloseTab, onNewTab, onEdit, focusTerminal } = props;
  const offer = activeTabId ? props.resume[activeTabId] : undefined;
  /** Tabs 1–8 have their own shortcut; the "last tab" one (⌘9) belongs to the last tab, wherever it is. */
  const tabKey = (i: number): string => {
    const last = task.tabs.length - 1;
    if (i === last && last >= 8) return key('tab9');
    return i < 8 ? key(`tab${i + 1}` as CommandId) : '';
  };

  // Keep the selected tab in view when the tab bar scrolls.
  useEffect(() => {
    document.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);
  const [resumeError, setResumeError] = useState<{ tabId: string; text: string }>();
  // Terminal titles (set by programs like Claude Code) live outside React.
  useSyncExternalStore(terminals.subscribe, terminals.getVersion);
  const key = (id: CommandId) => formatAccelerator(acceleratorFor(settings, id));
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
          const agent = agentFor(agents, tab.id);
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
              {agent && (
                <AgentDot
                  state={effectiveTabState(agent, effectivePolicy(settings.policy, task.policy))}
                  detail={backgroundSummary(agent.backgroundTasks)}
                />
              )}
              <span className="tab-title">{title}</span>
              {tabKey(i) && <span className="tab-key">{tabKey(i)}</span>}
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

      {offer && activeTabId && (
        <div className="resume-banner">
          <span>
            {resumeError?.tabId === activeTabId ? (
              <span className="resume-error">{resumeError.text}</span>
            ) : (
              <>
                Claude was running in this tab before Humanloop quit
                <span className="resume-cwd">{shortenHome(offer.cwd, homeDir)}</span>
              </>
            )}
          </span>
          <button
            className="primary"
            onClick={() =>
              void api.resumeSession(activeTabId).then((text) => setResumeError(text ? { tabId: activeTabId, text } : undefined))
            }
          >
            Resume Session
          </button>
          <button className="ghost" onClick={() => api.dismissResume(activeTabId)}>
            Dismiss
          </button>
        </div>
      )}

      {activeTabId ? (
        <div
          className="terminal-area"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            // Dropping files pastes their paths, quoted, like Terminal does. A
            // name with control characters is left out: inside a terminal
            // they act as keys (Ctrl-U, Return), which quoting can't stop.
            e.preventDefault();
            const paths = api.pathsForFiles([...e.dataTransfer.files]).filter((p) => !/[\x00-\x1f\x7f]/.test(p));
            const h = terminals.peek(activeTabId);
            if (!paths.length || !h) return;
            h.paste(paths.map(shellQuote).join(' ') + ' ');
            h.focus();
          }}
        >
          {props.find && (
            <FindBar
              tabId={activeTabId}
              query={props.find.query}
              focusSignal={props.find.focusSignal}
              onQuery={props.onFindQuery}
              onClose={props.onCloseFind}
              keys={{ next: key('findNext'), previous: key('findPrevious') }}
            />
          )}
          <TerminalPane key={activeTabId} tabId={activeTabId} focus={focusTerminal && !props.find} />
        </div>
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
