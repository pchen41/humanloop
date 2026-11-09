import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CommandId } from '../../shared/commands';
import { acceleratorFor } from '../../shared/shortcuts';
import { agentFor, type TabAgent } from '../../shared/agents';
import { effectivePolicy, type Settings, type Task } from '../../shared/model';
import type { ResumeOffer } from '../../shared/ipc';
import { backgroundSummary, Glyph, tabGlyphKind } from './Glyph';
import { FindBar } from './FindBar';
import { formatAccelerator, linkify, shellQuote, shortenHome } from './format';
import { CloseIcon, NewTabIcon } from './icons';
import { tip } from './Sidebar';
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
  onPark(): void;
  onDone(): void;
  focusTerminal: boolean;
  resume: Record<string, ResumeOffer>;
  /** The find bar, when open. */
  find: { query: string; focusSignal: number } | undefined;
  onFindQuery(query: string): void;
  onCloseFind(): void;
}

export function TaskView(props: Props) {
  const { task, activeTabId, settings, homeDir, agents, resume, onSelectTab, onCloseTab, onNewTab, onEdit, focusTerminal } = props;
  const offer = activeTabId ? resume[activeTabId] : undefined;
  const policy = effectivePolicy(settings.policy, task.policy);

  // Keep the selected tab in view when the tab bar scrolls.
  useEffect(() => {
    document.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);
  const [resumeError, setResumeError] = useState<{ tabId: string; text: string }>();
  // Terminal titles (set by programs like Claude Code) live outside React.
  useSyncExternalStore(terminals.subscribe, terminals.getVersion);
  const key = (id: CommandId) => formatAccelerator(acceleratorFor(settings, id));
  // The description shows as one line; the editor has the full text.
  const description = task.description.replace(/\s+/g, ' ').trim();

  return (
    <div className="task-view">
      <header className={`task-header ${description ? 'with-description' : ''}`}>
        <div className="task-heading">
          <h1 title={task.title}>{task.title}</h1>
          {description && (
            <p className="task-description" title={task.description}>
              {linkify(description).map((part, i) =>
                part.href ? (
                  <a
                    key={i}
                    href={part.href}
                    onClick={(e) => {
                      // The main process opens it in the default browser.
                      e.preventDefault();
                      window.open(part.href);
                    }}
                  >
                    {part.text}
                  </a>
                ) : (
                  part.text
                ),
              )}
            </p>
          )}
        </div>
        <div className="task-actions">
          <button className="btn" onClick={onEdit} title={tip('Edit task', key('editTask'))}>
            Edit
          </button>
          <button className="btn" onClick={props.onPark} title={tip(task.queue === 'parked' ? 'Unpark task' : 'Park task', key('parkTask'))}>
            {task.queue === 'parked' ? 'Unpark' : 'Park'}
          </button>
          <button className="btn" onClick={props.onDone} title={tip(task.queue === 'done' ? 'Reopen task' : 'Mark done', key('markDone'))}>
            {task.queue === 'done' ? 'Reopen' : 'Done'}
          </button>
        </div>
      </header>

      <div className="tab-bar" role="tablist" aria-label="Terminal tabs">
        {task.tabs.map((tab) => {
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
              <Glyph
                kind={tabGlyphKind(agents, resume, tab.id, policy)}
                detail={agent ? backgroundSummary(agent.backgroundTasks) : undefined}
              />
              <span className="tab-title">{title}</span>
              <button
                className="tab-close"
                aria-label="Close tab"
                title={tip('Close tab', key('closeTab'))}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onCloseTab(tab.id)}
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
        <button className="ib tab-new" onClick={onNewTab} title={tip('New tab', key('newTab'))} aria-label="New tab">
          <NewTabIcon />
        </button>
      </div>

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
          {offer && (
            <div className="resume-row" role="group" aria-label="Resume Claude session">
              <Glyph kind="resumable" />
              <span className="resume-text">
                {resumeError?.tabId === activeTabId ? (
                  <span className="resume-error">{resumeError.text}</span>
                ) : (
                  <>
                    Claude was running here · <span className="mono">{shortenHome(offer.cwd, homeDir)}</span>
                  </>
                )}
              </span>
              <button
                className="btn primary"
                onClick={() =>
                  void api.resumeSession(activeTabId).then((text) => setResumeError(text ? { tabId: activeTabId, text } : undefined))
                }
              >
                Resume
              </button>
              <button className="btn" onClick={() => api.dismissResume(activeTabId)}>
                Dismiss
              </button>
            </div>
          )}
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
          {/* With Find open, typing stays in its field; switching tab or task moves it to the new terminal. */}
          <TerminalPane key={activeTabId} tabId={activeTabId} focus={focusTerminal && !findFieldFocused()} />
        </div>
      ) : (
        <div className="empty-main">
          <h2>No tabs</h2>
          <button className="btn primary big" onClick={onNewTab}>
            New tab {key('newTab') && <span className="k">{key('newTab')}</span>}
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

function findFieldFocused(): boolean {
  return document.activeElement?.closest('.find-bar') != null;
}
