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
  /** A copy of the dragged tab that follows the pointer along the strip, in window coordinates. */
  const [ghost, setGhost] = useState<{ x: number; y: number; width: number }>();
  /** Cancels the drag under way, if any: the tabs go back to their saved order. */
  const cancelDrag = useRef<() => void>(undefined);
  // A drag doesn't survive the strip going away or showing another task.
  useEffect(() => () => cancelDrag.current?.(), [task.id]);
  /** The task's tabs as of the last render, for a drop after tabs closed mid-drag. */
  const liveTabs = useRef(task.tabs);
  liveTabs.current = task.tabs;

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

  /**
   * Starts following a press on a tab. It becomes a drag once the pointer
   * moves a few pixels, and the order then follows the pointer and is saved on
   * release; Esc cancels it. The pointer is followed on the window: reordering
   * moves the pressed tab's element, which loses pointer capture.
   */
  const startDrag = (e: React.PointerEvent, id: string) => {
    cancelDrag.current?.();
    const startX = e.clientX;
    const tabBox = e.currentTarget.getBoundingClientRect();
    const grab = startX - tabBox.left;
    let order: string[] | undefined;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!bar.current) return;
      // The release was missed (a menu or another app took it): treat this as the drop.
      if ((ev.buttons & 1) === 0) return drop();
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        setDragging(id);
      }
      // The ghost stays on the strip, between its edges.
      const strip = bar.current.getBoundingClientRect();
      const x = Math.min(Math.max(ev.clientX - grab, strip.left), strip.right - tabBox.width);
      setGhost({ x, y: tabBox.top, width: tabBox.width });
      // The dragged tab goes before the first other tab whose middle is right of the pointer.
      const shown = [...bar.current.querySelectorAll<HTMLElement>('[data-tab-id]')];
      const others = shown.filter((el) => el.dataset.tabId !== id);
      const index = others.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2 < ev.clientX;
      }).length;
      const ids = others.map((el) => el.dataset.tabId!);
      const next = [...ids.slice(0, index), id, ...ids.slice(index)];
      if (next.join() !== shown.map((el) => el.dataset.tabId).join()) setDragOrder(next);
      order = next;
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !moved) return;
      // Esc cancels the drag; it doesn't reach the terminal (where it would stop Claude).
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
      window.removeEventListener('blur', drop);
      window.removeEventListener('keydown', onKey, true);
      cancelDrag.current = undefined;
      setGhost(undefined);
    };
    const cancel = () => {
      finish();
      setDragOrder(undefined);
      setDragging(undefined);
    };
    const drop = () => {
      finish();
      if (!moved) return;
      // Against the tabs there are now: one may have closed since the last move.
      const live = new Set(liveTabs.current.map((t) => t.id));
      const index = (order ?? []).filter((t) => live.has(t)).indexOf(id);
      // The saved order arrives with the state before moveTab answers (IPC keeps order).
      void (index >= 0 ? api.moveTab(id, index) : Promise.resolve()).finally(() => {
        setDragOrder(undefined);
        setDragging(undefined);
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
    window.addEventListener('blur', drop);
    window.addEventListener('keydown', onKey, true);
    cancelDrag.current = cancel;
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
              // A click on the strip (any button: middle closes, right opens the menu) would
              // otherwise take focus from the terminal (or Find) and leave it on the page,
              // where typing goes nowhere.
              e.preventDefault();
              if (e.button !== 0) return;
              onSelectTab(tab.id);
              if (!findFieldFocused()) requestAnimationFrame(() => terminals.peek(tab.id)?.focus());
            }}
            onPointerDown={(e) => {
              // A ctrl-click opens the tab menu instead (as a right-click).
              if (e.button === 0 && !e.ctrlKey) startDrag(e, tab.id);
            }}
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
      {ghost && dragging && byId.get(dragging) && (
        <div className="tab tab-ghost" aria-hidden style={{ left: ghost.x, top: ghost.y, width: ghost.width }}>
          <Glyph
            kind={tabGlyphKind(activity, byId.get(dragging)!, effectivePolicy(props.globalPolicy, task.policy, byId.get(dragging)!.policy))}
          />
          <span className="tab-title">{terminals.peek(dragging)?.title || byId.get(dragging)!.title}</span>
        </div>
      )}
      <button className="ib tab-new" onClick={props.onNewTab} title={tip('New tab', props.newTabKey)} aria-label="New tab">
        <NewTabIcon />
      </button>
    </div>
  );
}
