import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { DEFAULT_PRIORITY, POLICY_KEYS, PRIORITIES, type Policy, type Task, type TaskDraft } from '../../shared/model';
import { shortenHome } from './format';
import { PolicyControls, withPolicyChange } from './PolicyControls';

const api = window.humanloop;

export type EditorMode = { kind: 'create' } | { kind: 'edit'; task: Task };

interface Props {
  /** True while Settings is open on top of the editor. */
  inert?: boolean;
  mode: EditorMode;
  homeDir: string;
  globalDefaultCwd: string | undefined;
  globalPolicy: Policy;
  onClose(): void;
  /** Set to this editor's Save, so the menu's ⌘Return can save it. */
  submitRef?: RefObject<(() => void) | undefined>;
}


export function TaskEditor({ inert, mode, homeDir, globalDefaultCwd, globalPolicy, onClose, submitRef }: Props) {
  const existing = mode.kind === 'edit' ? mode.task : undefined;
  const [draft, setDraft] = useState<TaskDraft>({
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    priority: existing?.priority ?? DEFAULT_PRIORITY,
    defaultCwd: existing?.defaultCwd,
    policy: existing?.policy ?? {},
  });
  const overrides = POLICY_KEYS.filter((k) => draft.policy?.[k] !== undefined).length;
  // Open at first if the task has overrides; after that it opens and closes only when you click it.
  const [startOpen] = useState(overrides > 0);
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
      const clean = { ...draft, defaultCwd: draft.defaultCwd?.trim() || undefined };
      if (existing) await api.updateTask(existing.id, clean);
      else await api.createTask(clean);
      onClose();
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

  async function chooseDir() {
    const dir = await api.chooseDirectory(draft.defaultCwd || globalDefaultCwd);
    if (dir) set({ defaultCwd: dir });
  }

  const fallbackCwd = shortenHome(globalDefaultCwd, homeDir) ?? '~';

  return (
    <div className="modal-backdrop" inert={inert} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
          <small>P0 is the most urgent and comes first.</small>
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
          <small>The task's first tab opens here. After that, ⌘T opens where the current tab is.</small>
        </div>

        <details className="overrides" open={startOpen}>
          <summary>
            When is it your turn?{' '}
            {overrides ? `${overrides} ${overrides === 1 ? 'setting' : 'settings'} changed for this task` : 'Using your settings'}
          </summary>
          <PolicyControls value={draft.policy ?? {}} inherit={globalPolicy} onChange={(key, value) => setDraft((d) => ({ ...d, policy: withPolicyChange(d.policy ?? {}, key, value) }))}
          />
        </details>

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
