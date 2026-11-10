import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { DEFAULT_PRIORITY, PRIORITIES, type Policy, type Task, type TaskDraft } from '../../shared/model';
import { overrideCount, PolicyControls, withPolicyChange } from './PolicyControls';

const api = window.humanloop;

export type EditorMode = { kind: 'create' } | { kind: 'edit'; task: Task };

interface Props {
  mode: EditorMode;
  globalPolicy: Policy;
  /** `created`: a new task was saved (and is now open). */
  onClose(created?: boolean): void;
  /** Set to this editor's Save, so the menu's ⌘Return can save it. */
  submitRef?: RefObject<(() => void) | undefined>;
}


export function TaskEditor({ mode, globalPolicy, onClose, submitRef }: Props) {
  const existing = mode.kind === 'edit' ? mode.task : undefined;
  const [draft, setDraft] = useState<TaskDraft>({
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    priority: existing?.priority ?? DEFAULT_PRIORITY,
    defaultCwd: existing?.defaultCwd,
    policy: existing?.policy ?? {},
  });
  const overrides = overrideCount(draft.policy ?? {});
  const [rulesOpen, setRulesOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  // ⌘Return can arrive both as a key press and as a menu command; save only once.
  const savingRef = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  const set = (patch: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Default stores nothing, so the task follows Settings; a value picked explicitly is kept.
      const clean = { ...draft, policy: draft.policy ?? {}, defaultCwd: draft.defaultCwd?.trim() || undefined };
      if (existing) await api.updateTask(existing.id, clean);
      else await api.createTask(clean);
      onClose(!existing);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  if (submitRef) submitRef.current = () => void submit();
  useEffect(
    () => () => {
      if (submitRef) submitRef.current = undefined;
    },
    [submitRef],
  );

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      void submit();
    }
  }

  async function remove() {
    if (existing && (await api.deleteTask(existing.id))) onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet modal" role="dialog" aria-labelledby="editor-title" onSubmit={submit} onKeyDown={onKeyDown}>
        <div className="sheet-header">
          <h2 id="editor-title">{existing ? 'Edit task' : 'New task'}</h2>
          <span className="k">esc</span>
        </div>

        <div className="sheet-body">
          <div className="fld">
            <label className="lbl" htmlFor="task-title">
              Title
            </label>
            <input
              id="task-title"
              className="in"
              ref={titleRef}
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="What are you working on?"
            />
          </div>

          <div className="fld">
            <span className="lbl" id="task-priority">
              Priority
            </span>
            <div className="seg mono" role="radiogroup" aria-labelledby="task-priority">
              {PRIORITIES.map((p) => (
                <button
                  type="button"
                  key={p}
                  role="radio"
                  aria-checked={draft.priority === p}
                  className={draft.priority === p ? 'on' : ''}
                  onClick={() => set({ priority: p })}
                >
                  P{p}
                </button>
              ))}
            </div>
            <span className="help">Lower is more urgent.</span>
          </div>

          <div className="fld">
            <label className="lbl" htmlFor="task-description">
              Description
            </label>
            <textarea
              id="task-description"
              className="in"
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>

          <button type="button" className="disclosure" aria-expanded={rulesOpen} onClick={() => setRulesOpen((o) => !o)}>
            Turn rules
            <span className="help">
              {overrides ? `${overrides} ${overrides === 1 ? 'override' : 'overrides'}` : 'Same as Settings'}
            </span>
          </button>
          {rulesOpen && <span className="help rules-help">Default follows Settings. Tabs follow the task unless set in their menu.</span>}
          {rulesOpen && (
            <PolicyControls
              value={draft.policy ?? {}}
              inherit={globalPolicy}
              onChange={(key, value) => setDraft((d) => ({ ...d, policy: withPolicyChange(d.policy ?? {}, key, value) }))}
            />
          )}
        </div>

        <div className="sheet-footer">
          {existing && (
            <button type="button" className="btn danger" onClick={() => void remove()}>
              Delete task…
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn solid" onClick={() => onClose()}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {existing ? 'Save' : 'Create task'} <span className="k">⌘↩</span>
          </button>
        </div>
      </form>
    </div>
  );
}
