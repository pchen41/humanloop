import { POLICY_KEYS, type Policy } from '../../shared/model';

type Key = (typeof POLICY_KEYS)[number];

const FIELDS: { key: Key; label: string; options: [Policy[Key], string][]; hint: string }[] = [
  {
    key: 'multiAgent',
    label: 'Several Claude tabs',
    options: [
      ['any', 'Any tab done'],
      ['all', 'All tabs done'],
    ],
    hint: "Your turn once one tab's Claude is done, or only once all are. A tab that needs you always counts.",
  },
  {
    key: 'subagentsBusy',
    label: 'Background subagents',
    options: [
      [true, 'Busy'],
      [false, 'Ignore'],
    ],
    hint: 'Busy keeps the task in Agent’s Turn while subagents run; they usually finish and report back.',
  },
  {
    key: 'backgroundShellsBusy',
    label: 'Background shells',
    options: [
      [true, 'Busy'],
      [false, 'Ignore'],
    ],
    hint: 'Dev servers and watchers never exit, so counting them can keep a task busy forever.',
  },
];

export type PolicyKey = Key;

/** One field changed. Undefined means "use the default" (task overrides only). */
export type PolicyChange = <K extends Key>(key: K, value: Policy[K] | undefined) => void;

/** Applies one change to a set of overrides. */
export function withPolicyChange(policy: Partial<Policy>, key: Key, value: Policy[Key] | undefined): Partial<Policy> {
  const next = { ...policy };
  if (value === undefined) delete next[key];
  else (next as Record<Key, unknown>)[key] = value;
  return next;
}

interface Props {
  value: Partial<Policy>;
  /**
   * Reports only the field that changed, so two quick clicks can't undo each
   * other while the first is still being saved.
   */
  onChange: PolicyChange;
  /** For a task: the global settings. Adds a Default choice that uses them. */
  inherit?: Policy;
}

/** The three readiness settings, for the settings screen or one task's overrides. */
export function PolicyControls({ value, onChange, inherit }: Props) {
  return (
    <>
      {FIELDS.map(({ key, label, options, hint }) => {
        const set = (v: Policy[Key] | undefined) => onChange(key, v);
        const choices: [Policy[Key] | undefined, string][] = inherit
          ? [[undefined, `Default (${options.find(([v]) => v === inherit[key])?.[1]})`], ...options]
          : options;
        return (
          <div className="field" key={key}>
            <span>{label}</span>
            <div className="segmented" role="radiogroup" aria-label={label}>
              {choices.map(([v, text]) => (
                <button
                  type="button"
                  key={String(v)}
                  role="radio"
                  aria-checked={value[key] === v}
                  className={value[key] === v ? 'selected' : ''}
                  onClick={() => set(v)}
                >
                  {text}
                </button>
              ))}
            </div>
            {!inherit && <small>{hint}</small>}
          </div>
        );
      })}
    </>
  );
}
