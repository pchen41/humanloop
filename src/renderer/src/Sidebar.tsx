import { useEffect, useState } from 'react';
import { effectivePolicy, QUEUE_LABELS, QUEUES, type AppState, type Queue, type Settings, type Task } from '../../shared/model';
import { canGoBack, canGoForward } from '../../shared/queues';
import { acceleratorFor } from '../../shared/shortcuts';
import { tasksInQueue } from '../../shared/tasks';
import { Glyph, tabGlyphKind, type TabActivity } from './Glyph';
import { formatAccelerator, formatWait, tip } from './format';
import { BackIcon, ForwardIcon } from './icons';

interface Props {
  /** True while a dialog is open over the window. */
  inert?: boolean;
  state: AppState;
  settings: Settings;
  activity: TabActivity;
  /** Which queues are folded away; ⌘↑ and ⌘↓ skip them too. */
  collapsed: Record<Queue, boolean>;
  onToggleQueue(queue: Queue): void;
  onOpen(id: string): void;
  onEdit(task: Task): void;
  onMenu(task: Task): void;
  /** Settings covers the task: Back returns to it, and there is nothing to go Forward to. */
  settingsOpen: boolean;
  onBack(): void;
  onForward(): void;
}


/** Re-renders every 10 seconds so wait times stay current. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const WIDTH_KEY = 'sidebarWidth';
const DEFAULT_WIDTH = 288;
const MIN_WIDTH = 200;
const MAX_WIDTH = 520;

function applyWidth(px: number): void {
  document.documentElement.style.setProperty('--sidebar-width', `${px}px`);
}

// The width you dragged to is a per-machine preference; storage may be unavailable.
try {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) applyWidth(saved);
} catch {
  // keep the default
}

/** Drag the sidebar's right edge to resize it; double-click resets it. */
function Resizer() {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let width = DEFAULT_WIDTH;
    const move = (ev: PointerEvent) => {
      width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX)));
      applyWidth(width);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      try {
        localStorage.setItem(WIDTH_KEY, String(width));
      } catch {
        // not saved; fine
      }
    };
    width = handle.parentElement?.getBoundingClientRect().width ?? DEFAULT_WIDTH;
    document.body.classList.add('resizing');
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  const reset = () => {
    applyWidth(DEFAULT_WIDTH);
    try {
      localStorage.removeItem(WIDTH_KEY);
    } catch {
      // ignore
    }
  };
  return <div className="sidebar-resizer" onPointerDown={onPointerDown} onDoubleClick={reset} title="Drag to resize" />;
}

export function Sidebar(props: Props) {
  const { inert, state, settings, activity, collapsed, onOpen, onEdit, onMenu, settingsOpen, onBack, onForward } = props;
  const now = useNow();
  // Keep the open task in view: after Next task or Back opens one further
  // down, and when it moves to another queue on its own.
  const openQueue = state.tasks.find((t) => t.id === state.openTaskId)?.queue;
  useEffect(() => {
    document.querySelector('.task-row.open')?.scrollIntoView({ block: 'nearest' });
  }, [state.openTaskId, openQueue]);
  const key = (id: 'back' | 'forward') => formatAccelerator(acceleratorFor(settings, id));

  return (
    <nav className="sidebar" data-testid="sidebar" inert={inert} aria-label="Task queues">
      <Resizer />
      <div className="sidebar-top">
        <button className="ib" onClick={onBack} disabled={!settingsOpen && !canGoBack(state)} title={tip('Back', key('back'))} aria-label="Back">
          <BackIcon />
        </button>
        <button
          className="ib"
          onClick={onForward}
          disabled={settingsOpen || !canGoForward(state)}
          title={tip('Forward', key('forward'))}
          aria-label="Forward"
        >
          <ForwardIcon />
        </button>
      </div>
      <div className="queues">
        {QUEUES.map((queue) => {
          const tasks = tasksInQueue(state, queue);
          const isCollapsed = collapsed[queue];
          // A collapsed section still shows the open task, so it is always visible.
          const shown = isCollapsed ? tasks.filter((t) => t.id === state.openTaskId) : tasks;
          return (
            <section key={queue} className={`queue ${queue}`}>
              <button
                className="queue-header"
                onClick={() => props.onToggleQueue(queue)}
                aria-expanded={!isCollapsed}
              >
                <span className="queue-title">
                  <span>{QUEUE_LABELS[queue]}</span>
                  <span className={`queue-count ${queue === 'yourTurn' && tasks.length ? 'you' : ''}`}>{tasks.length}</span>
                </span>
              </button>
              {(shown.length > 0 || (!isCollapsed && queue === 'yourTurn')) && (
                <ul className="task-list">
                  {shown.map((task) => (
                    <li key={task.id}>
                      <TaskRow
                        task={task}
                        open={task.id === state.openTaskId}
                        wait={formatWait(task.enteredAt, now)}
                        settings={settings}
                        activity={activity}
                        onOpen={onOpen}
                        onEdit={onEdit}
                        onMenu={onMenu}
                      />
                    </li>
                  ))}
                  {!isCollapsed && tasks.length === 0 && <li className="queue-empty">Nothing waiting on you</li>}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </nav>
  );
}

function TaskRow(props: {
  task: Task;
  open: boolean;
  wait: string;
  settings: Settings;
  activity: TabActivity;
  onOpen(id: string): void;
  onEdit(task: Task): void;
  onMenu(task: Task): void;
}) {
  const { task, settings, activity } = props;
  return (
    <button
      className={`task-row ${props.open ? 'open' : ''}`}
      aria-current={props.open || undefined}
      onClick={() => props.onOpen(task.id)}
      onDoubleClick={() => props.onEdit(task)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(task);
      }}
      data-tip={task.title}
      data-tip-measure=".task-title"
    >
      {/* P2 and P3 show no chip; the order within the queue carries them. */}
      {task.priority <= 1 && <span className={`priority p${task.priority}`}>P{task.priority}</span>}
      <span className="task-title">{task.title}</span>
      {task.tabs.length > 0 && (
        <span className="dots">
          {task.tabs.map((tab) => (
            <Glyph key={tab.id} kind={tabGlyphKind(activity, tab, effectivePolicy(settings.policy, task.policy, tab.policy))} />
          ))}
        </span>
      )}
      <span className={`task-wait ${task.queue === 'yourTurn' ? 'you' : ''}`}>{props.wait}</span>
    </button>
  );
}
