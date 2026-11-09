import { useEffect, useState } from 'react';
import { commandById } from '../../shared/commands';
import { QUEUE_LABELS, QUEUES, type AppState, type Queue, type Settings, type Task } from '../../shared/model';
import { tasksInQueue } from '../../shared/tasks';
import { formatAccelerator, formatWait } from './format';

interface Props {
  state: AppState;
  settings: Settings;
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

export function Sidebar({ state, settings, onOpen, onEdit, onMenu, onNew }: Props) {
  const now = useNow();
  const [collapsed, setCollapsed] = useState<Record<Queue, boolean>>({
    yourTurn: false,
    agentsTurn: false,
    parked: false,
    done: true,
  });
  const newTaskKey = formatAccelerator(settings.shortcuts.newTask ?? commandById('newTask').accelerator);

  return (
    <nav className="sidebar" data-testid="sidebar">
      <div className="sidebar-top" />
      <div className="queues">
        {QUEUES.map((queue) => {
          const tasks = tasksInQueue(state, queue);
          const isCollapsed = collapsed[queue];
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
              {!isCollapsed && (
                <ul className="task-list">
                  {tasks.map((task) => (
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
                        <span className="task-title">{task.title}</span>
                        <span className="task-wait">{formatWait(task.enteredAt, now)}</span>
                      </button>
                    </li>
                  ))}
                  {tasks.length === 0 && queue === 'yourTurn' && <li className="queue-empty">Nothing waiting on you</li>}
                </ul>
              )}
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
