import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CommandId } from '../../shared/commands';
import { acceleratorFor } from '../../shared/shortcuts';
import { agentFor } from '../../shared/agents';
import { effectivePolicy, type Policy, type Settings, type Task } from '../../shared/model';
import { backgroundSummary, Glyph, tabGlyphKind, type TabActivity } from './Glyph';
import { FindBar } from './FindBar';
import { formatAccelerator, linkify, shellQuote, shortenHome, tip } from './format';
import { NewTabIcon, TabMenuIcon } from './icons';
import { terminals } from './terminals';

const api = window.humanloop;

interface Props {
  task: Task;
  activeTabId: string | undefined;
  settings: Settings;
  homeDir: string;
  activity: TabActivity;
  onSelectTab(tabId: string): void;
  onCloseTab(tabId: string): void;
  onNewTab(): void;
  focusTerminal: boolean;
  /** The find bar, when open. */
  find: { query: string; focusSignal: number } | undefined;
  onFindQuery(query: string): void;
  onCloseFind(): void;
}

export function TaskView(props: Props) {
  const { task, activeTabId, settings, homeDir, activity, onSelectTab, onCloseTab, onNewTab, focusTerminal } = props;
  const offer = activeTabId && Object.hasOwn(activity.resume, activeTabId) ? activity.resume[activeTabId] : undefined;
  const [resumeError, setResumeError] = useState<{ tabId: string; text: string }>();
  const key = (id: CommandId) => formatAccelerator(acceleratorFor(settings, id));
  // The description shows as one line; the editor has the full text.
  const description = task.description.replace(/\s+/g, ' ').trim();

  return (
    <div className="task-view">
      {/* The title is in the top bar; the description, if any, sits just under it. */}
      {description && (
        <p className="task-description" title={task.description}>
          {linkify(description).map((part, i) =>
            part.href ? (
              <a
                key={i}
                href={part.href}
                title={part.href}
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

      <TabStrip
        task={task}
        activeTabId={activeTabId}
        activity={activity}
        globalPolicy={settings.policy}
        newTabKey={key('newTab')}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
      />

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
          {/* With Find focused, typing stays in its field (and it searches the tab you switch to). */}
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

/** Drag past this many pixels before a press on a tab becomes a drag. */
const DRAG_THRESHOLD = 4;

/**
 * The tab strip: a glyph and name per tab, a ⌄ that opens the tab's menu
 * (on the selected tab and the one under the pointer), and + for a new tab.
 * Tabs are reordered by dragging; the order shows live and is saved on drop.
 */
function TabStrip(props: {
  task: Task;
  activeTabId: string | undefined;
  activity: TabActivity;
  globalPolicy: Policy;
  newTabKey: string;
  onSelectTab(tabId: string): void;
  onCloseTab(tabId: string): void;
  onNewTab(): void;
}) {
  const { task, activeTabId, activity, onSelectTab } = props;
  // Terminal titles (set by programs like Claude Code) live outside React.
  useSyncExternalStore(terminals.subscribe, terminals.getVersion);
  const bar = useRef<HTMLDivElement>(null);
  /** The tab whose menu is open. */
  const [menuFor, setMenuFor] = useState<string>();
  /** The order while a drag is under way. */
  const [dragOrder, setDragOrder] = useState<string[]>();
  const [dragging, setDragging] = useState<string>();
  const drag = useRef<{ id: string; startX: number; moved: boolean }>(undefined);

  // Keep the selected tab in view when the tab bar scrolls.
  useEffect(() => {
    bar.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  const byId = new Map(task.tabs.map((t) => [t.id, t]));
  const tabs = dragOrder
    ? [...dragOrder.flatMap((id) => byId.get(id) ?? []), ...task.tabs.filter((t) => !dragOrder.includes(t.id))]
    : task.tabs;

  const openMenu = async (tabId: string, at: { x: number; y: number }) => {
    setMenuFor(tabId);
    try {
      await api.showTabMenu(tabId, at, tabId === activeTabId);
    } finally {
      setMenuFor(undefined);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !bar.current) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(d.id);
    }
    // The dragged tab goes before the first other tab whose middle is right of the pointer.
    const others = [...bar.current.querySelectorAll<HTMLElement>('[data-tab-id]')].filter((el) => el.dataset.tabId !== d.id);
    const index = others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 < e.clientX;
    }).length;
    const ids = others.map((el) => el.dataset.tabId!);
    const next = [...ids.slice(0, index), d.id, ...ids.slice(index)];
    if (next.join() !== tabs.map((t) => t.id).join()) setDragOrder(next);
  };

  const endDrag = async () => {
    const d = drag.current;
    drag.current = undefined;
    if (!d?.moved) return;
    const index = tabs.findIndex((t) => t.id === d.id);
    try {
      if (index >= 0) await api.moveTab(d.id, index);
    } finally {
      // The saved order has arrived with the state by now (IPC keeps order).
      setDragOrder(undefined);
      setDragging(undefined);
    }
  };

  return (
    <div className="tab-bar" role="tablist" aria-label="Terminal tabs" ref={bar}>
      {tabs.map((tab) => {
        const title = terminals.peek(tab.id)?.title || tab.title;
        const agent = agentFor(activity.agents, tab.id);
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            role="tab"
            aria-selected={active}
            className={`tab${active ? ' active' : ''}${tab.muted ? ' muted' : ''}${menuFor === tab.id ? ' menu' : ''}${dragging === tab.id ? ' dragging' : ''}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              // A click on the strip would otherwise take focus from the terminal (or Find)
              // and leave it on the page, where typing goes nowhere.
              e.preventDefault();
              onSelectTab(tab.id);
              if (!findFieldFocused()) requestAnimationFrame(() => terminals.peek(tab.id)?.focus());
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              drag.current = { id: tab.id, startX: e.clientX, moved: false };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={onPointerMove}
            onPointerUp={() => void endDrag()}
            onPointerCancel={() => void endDrag()}
            onAuxClick={(e) => {
              if (e.button === 1) props.onCloseTab(tab.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              void openMenu(tab.id, { x: e.clientX, y: e.clientY });
            }}
          >
            <Glyph
              kind={tabGlyphKind(activity, tab, effectivePolicy(props.globalPolicy, task.policy, tab.policy))}
              detail={agent && !tab.muted ? backgroundSummary(agent.backgroundTasks) : undefined}
            />
            <span className="tab-title" data-tip={title}>
              {title}
            </span>
            <button
              className="tab-menu"
              aria-label={`Options for ${title}`}
              aria-haspopup="menu"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => {
                // Keeps focus where it is (the terminal), and doesn't select the tab.
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                const r = e.currentTarget.closest('.tab')!.getBoundingClientRect();
                void openMenu(tab.id, { x: r.left, y: r.bottom + 2 });
              }}
            >
              <TabMenuIcon />
            </button>
          </div>
        );
      })}
      <button className="ib tab-new" onClick={props.onNewTab} title={tip('New tab', props.newTabKey)} aria-label="New tab">
        <NewTabIcon />
      </button>
    </div>
  );
}
