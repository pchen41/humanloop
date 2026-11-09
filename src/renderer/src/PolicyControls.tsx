import { POLICY_KEYS, type Policy } from '../../shared/model';

type Key = (typeof POLICY_KEYS)[number];

const FIELDS: { key: Key; label: string; options: [Policy[Key], string][]; help: string }[] = [
  {
    key: 'multiAgent',
    label: 'Multiple Claude tabs',
    options: [
      ['any', 'After one finishes'],
      ['all', 'After all finish'],
    ],
    help: 'Decides when a task with more than one Claude running becomes your turn.',
  },
  {
    key: 'subagentsBusy',
    label: 'Background subagents',
    options: [
      [true, 'Wait for them'],
      [false, 'Ignore them'],
    ],
    help: "Whether a task stays Claude's turn while subagents it started are still running.",
  },
  {
    key: 'backgroundShellsBusy',
    label: 'Background shells',
    options: [
      [true, 'Wait for them'],
      [false, 'Ignore them'],
    ],
    help: "Whether a task stays Claude's turn while dev servers or watchers it started are still running.",
  },
];

export type PolicyKey = Key;

/** One field changed. Undefined means "use the global setting" (task overrides only). */
export type PolicyChange = <K extends Key>(key: K, value: Policy[K] | undefined) => void;

/** Applies one change to a set of overrides. */
export function withPolicyChange(policy: Partial<Policy>, key: Key, value: Policy[Key] | undefined): Partial<Policy> {
  const next = { ...policy };
  if (value === undefined) delete next[key];
  else (next as Record<Key, unknown>)[key] = value;
  return next;
}

/** How many of a task's turn rules differ from the global ones. */
export function overrideCount(policy: Partial<Policy>, global: Policy): number {
  return POLICY_KEYS.filter((k) => policy[k] !== undefined && policy[k] !== global[k]).length;
}

interface Props {
  value: Partial<Policy>;
  /**
   * Reports only the field that changed, so two quick clicks can't undo each
   * other while the first is still being saved.
   */
  onChange: PolicyChange;
  /**
   * For a task: the global settings. Their value is marked "default", and
   * choosing it stores no override.
   */
  inherit?: Policy;
}

/**
 * The three turn rules: rows with the control at the right for Settings, or
 * label-above-control fields for one task's overrides.
 */
export function PolicyControls({ value, onChange, inherit }: Props) {
  return (
    <>
      {FIELDS.map(({ key, label, options, help }) => {
        const current = value[key] ?? inherit?.[key];
        const id = `policy-${key}${inherit ? '-task' : ''}`;
        const seg = (
          <div className="seg" role="radiogroup" aria-labelledby={id}>
            {options.map(([v, text]) => {
              const on = current === v;
              const isDefault = inherit !== undefined && inherit[key] === v;
              return (
                <button
                  type="button"
                  key={String(v)}
                  role="radio"
                  aria-checked={on}
                  className={`${on ? 'on' : ''} ${on && inherit && !isDefault ? 'ov' : ''}`}
                  onClick={() => onChange(key, inherit && isDefault ? undefined : v)}
                >
                  {text}
                  {isDefault && <span className="sub">default</span>}
                </button>
              );
            })}
          </div>
        );
        return inherit ? (
          <div className="fld" key={key}>
            <span className="lbl" id={id}>
              {label}
            </span>
            {seg}
            <span className="help">{help}</span>
          </div>
        ) : (
          <div className="srow" key={key}>
            <div className="t">
              <b id={id}>{label}</b>
              <span className="help">{help}</span>
            </div>
            {seg}
          </div>
        );
      })}
    </>
  );
}
