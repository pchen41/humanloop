import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { DEFAULT_PRIORITY, type Priority, type Task, type TaskDraft } from '../../shared/model';
import { shortenHome } from './format';

const api = window.humanloop;

export type EditorMode = { kind: 'create' } | { kind: 'edit'; task: Task };

interface Props {
  mode: EditorMode;
  homeDir: string;
  globalDefaultCwd: string | undefined;
  onClose(): void;
}

const PRIORITIES: Priority[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function TaskEditor({ mode, homeDir, globalDefaultCwd, onClose }: Props) {
  const existing = mode.kind === 'edit' ? mode.task : undefined;
  const [draft, setDraft] = useState<TaskDraft>({
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    priority: existing?.priority ?? DEFAULT_PRIORITY,
    defaultCwd: existing?.defaultCwd,
  });
  const titleRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const set = (patch: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const clean = { ...draft, defaultCwd: draft.defaultCwd?.trim() || undefined };
      if (existing) await api.updateTask(existing.id, clean);
      else await api.createTask(clean);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && e.metaKey) {
      void submit();
    }
  }

  async function chooseDir() {
    const dir = await api.chooseDirectory(draft.defaultCwd || globalDefaultCwd);
    if (dir) set({ defaultCwd: dir });
  }

  const fallbackCwd = shortenHome(globalDefaultCwd, homeDir) ?? '~';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} onKeyDown={onKeyDown}>
        <h2>{existing ? 'Edit Task' : 'New Task'}</h2>

        <label className="field">
          <span>Title</span>
          <input
            ref={titleRef}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="What are you working on?"
          />
        </label>

        <div className="field">
          <span>Priority</span>
          <div className="segmented" role="radiogroup" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button
                type="button"
                key={p}
                role="radio"
                aria-checked={draft.priority === p}
                className={`p${p} ${draft.priority === p ? 'selected' : ''}`}
                onClick={() => set({ priority: p })}
              >
                P{p}
              </button>
            ))}
          </div>
          <small>P0 comes first.</small>
        </div>

        <label className="field">
          <span>Description</span>
          <textarea
            rows={4}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Notes, links, what done looks like…"
          />
        </label>

        <div className="field">
          <span>Default directory</span>
          <div className="row">
            <input
              value={draft.defaultCwd ?? ''}
              onChange={(e) => set({ defaultCwd: e.target.value })}
              placeholder={fallbackCwd}
              spellCheck={false}
            />
            <button type="button" onClick={chooseDir}>
              Choose…
            </button>
          </div>
          <small>New tabs for this task open here.</small>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {existing ? 'Save' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  );
}
