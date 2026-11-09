import { useEffect, useState } from 'react';
import { acceleratorFor } from '../../shared/shortcuts';
import type { TabAgent } from '../../shared/agents';
import { hasOverrides, QUEUE_LABELS, QUEUES, type AppState, type Queue, type Settings, type Task } from '../../shared/model';
import { AgentDot } from './AgentDot';
import { agentStateOf } from '../../shared/queues';
import { tasksInQueue } from '../../shared/tasks';
import { formatAccelerator, formatWait } from './format';

interface Props {
  /** True while a dialog is open over the window. */
  inert?: boolean;
  state: AppState;
  settings: Settings;
  agents: Record<string, TabAgent>;
  onOpen(id: string): void;
  onEdit(task: Task): void;
  onMenu(task: Task): void;
  onNew(): void;
}

/** Re-renders every 30 seconds so wait times stay current. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const WIDTH_KEY = 'sidebarWidth';
const DEFAULT_WIDTH = 268;
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

export function Sidebar({ inert, state, settings, agents, onOpen, onEdit, onMenu, onNew }: Props) {
  const now = useNow();
  const [collapsed, setCollapsed] = useState<Record<Queue, boolean>>({
    yourTurn: false,
    agentsTurn: false,
    parked: false,
    done: true,
  });
  const stateOf = agentStateOf(agents, settings.policy);
  // Keep the open task in view: after Next task or Back opens one further
  // down, and when it moves to another queue on its own.
  const openQueue = state.tasks.find((t) => t.id === state.openTaskId)?.queue;
  useEffect(() => {
    document.querySelector('.task-row.open')?.scrollIntoView({ block: 'nearest' });
  }, [state.openTaskId, openQueue]);
  const newTaskKey = formatAccelerator(acceleratorFor(settings, 'newTask'));

  return (
    <nav className="sidebar" data-testid="sidebar" inert={inert}>
      <Resizer />
      <div className="sidebar-top" />
      <div className="queues">
        {QUEUES.map((queue) => {
          const tasks = tasksInQueue(state, queue);
          const isCollapsed = collapsed[queue];
          // A collapsed section still shows the open task, so it is always visible.
          const shown = isCollapsed ? tasks.filter((t) => t.id === state.openTaskId) : tasks;
          return (
            <section key={queue} className="queue">
              <button
                className="queue-header"
                onClick={() => setCollapsed((c) => ({ ...c, [queue]: !c[queue] }))}
                aria-expanded={!isCollapsed}
              >
                <span className={`chevron ${isCollapsed ? '' : 'open'}`}>›</span>
                <span className="queue-name">{QUEUE_LABELS[queue]}</span>
                <span className="queue-count">{tasks.length || ''}</span>
              </button>
              {shown.length > 0 || !isCollapsed ? (
                <ul className="task-list">
                  {shown.map((task) => (
                    <li key={task.id}>
                      <button
                        className={`task-row ${task.id === state.openTaskId ? 'open' : ''}`}
                        onClick={() => onOpen(task.id)}
                        onDoubleClick={() => onEdit(task)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onMenu(task);
                        }}
                        title={task.description || task.title}
                      >
                        <span className={`priority p${task.priority}`}>P{task.priority}</span>
                        <AgentDot state={stateOf(task)} />
                        <span className="task-title">{task.title}</span>
                        {hasOverrides(task) && (
                          <span className="override-mark" title="Has its own “When is it your turn?” settings" />
                        )}
                        <span className="task-wait">{formatWait(task.enteredAt, now)}</span>
                      </button>
                    </li>
                  ))}
                  {!isCollapsed && tasks.length === 0 && queue === 'yourTurn' && (
                    <li className="queue-empty">Nothing waiting on you</li>
                  )}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
      <button className="new-task" onClick={onNew}>
        <span>+ New Task</span>
        <kbd>{newTaskKey}</kbd>
      </button>
    </nav>
  );
}
