import { POLICY_KEYS, type Policy } from '../../shared/model';

type Key = (typeof POLICY_KEYS)[number];

/** Each option: its value, its label, and the short form shown after "Default". */
const FIELDS: { key: Key; label: string; options: [Policy[Key], string, string][]; help: string }[] = [
  {
    key: 'multiAgent',
    label: 'Multiple Claude tabs',
    options: [
      ['any', 'After one finishes', 'after one'],
      ['all', 'After all finish', 'after all'],
    ],
    help: 'Decides when a task with more than one Claude running becomes your turn.',
  },
  {
    key: 'subagentsBusy',
    label: 'Background subagents',
    options: [
      [true, 'Wait for them', 'wait'],
      [false, 'Ignore them', 'ignore'],
    ],
    help: "Whether a task stays Claude's turn while subagents it started are still running.",
  },
  {
    key: 'backgroundShellsBusy',
    label: 'Background shells',
    options: [
      [true, 'Wait for them', 'wait'],
      [false, 'Ignore them', 'ignore'],
    ],
    help: "Whether a task stays Claude's turn while dev servers or watchers it started are still running.",
  },
  {
    key: 'commandsBusy',
    label: 'Running commands',
    options: [
      [true, 'Wait for them', 'wait'],
      [false, 'Ignore them', 'ignore'],
    ],
    help: "Whether a task is the agent's turn while a command you ran in it runs longer than 5 seconds.",
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

/** How many of a task's turn rules are set rather than following Settings. */
export function overrideCount(policy: Partial<Policy>): number {
  return POLICY_KEYS.filter((k) => policy[k] !== undefined).length;
}

interface Props {
  value: Partial<Policy>;
  /**
   * Reports only the field that changed, so two quick clicks can't undo each
   * other while the first is still being saved.
   */
  onChange: PolicyChange;
  /**
   * For a task: the global settings. A Default option comes first, showing
   * their value; choosing it stores no override.
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
        const id = `policy-${key}${inherit ? '-task' : ''}`;
        const own = value[key];
        const button = (v: Policy[Key] | undefined, text: string, sub?: string) => {
          const on = own === v;
          return (
            <button
              type="button"
              key={String(v)}
              role="radio"
              aria-checked={on}
              className={`${on ? 'on' : ''} ${on && inherit && v !== undefined ? 'ov' : ''}`}
              onClick={() => onChange(key, v)}
            >
              {text}
              {sub && <span className="sub">{sub}</span>}
            </button>
          );
        };
        const seg = (
          <div className="seg" role="radiogroup" aria-labelledby={id}>
            {/* For a task, Default follows Settings, whose value it shows. */}
            {inherit && button(undefined, 'Default', options.find(([v]) => v === inherit[key])?.[2])}
            {options.map(([v, text]) => button(v, text))}
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
