import { useEffect, useState } from 'react';
import { COMMAND_GROUPS, commandById, type CommandId } from '../../shared/commands';
import type { Settings } from '../../shared/model';
import { acceleratorFor, sameAccelerator } from '../../shared/shortcuts';
import { formatAccelerator } from './format';

const api = window.humanloop;

type Notice =
  | { id: CommandId; kind: 'error'; text: string }
  /** `value` is what was being set: an accelerator, or null for the default. */
  | { id: CommandId; kind: 'conflict'; value: string | null; other: CommandId };

/** Every command's shortcut, with Record, Reset and Remove. Changes save at once. */
export function ShortcutsSection({ settings }: { settings: Settings }) {
  const [recording, setRecording] = useState<CommandId>();
  const [notice, setNotice] = useState<Notice>();

  // Stop listening if the screen closes mid-recording.
  useEffect(() => () => api.stopRecording(), []);

  /**
   * Saves a shortcut (null = the default). Main checks for a clash against
   * settings.json as it is now; `takeFrom` is the command you agreed to take it from.
   */
  async function set(id: CommandId, value: string | null, takeFrom?: CommandId) {
    const { conflict } = await api.setShortcut(id, value, takeFrom);
    setNotice(conflict ? { id, kind: 'conflict', value, other: conflict } : undefined);
  }

  async function record(id: CommandId) {
    if (recording === id) {
      api.stopRecording();
      return;
    }
    setNotice(undefined);
    setRecording(id);
    const r = await api.recordShortcut();
    setRecording((cur) => (cur === id ? undefined : cur));
    if (!r) return;
    if ('error' in r) setNotice({ id, kind: 'error', text: r.error });
    else await set(id, r.accelerator);
  }

  function renderRow(id: CommandId) {
    const label = commandById(id).label.replace(/…$/, '');
    const current = acceleratorFor(settings, id);
    const isDefault = sameAccelerator(current ?? '', commandById(id).accelerator);
    const mine = notice?.id === id ? notice : undefined;
    return (
      <div key={id}>
        <div className="shortcut-row">
          <span className="shortcut-label">{label}</span>
          <button
            type="button"
            className={`shortcut-key ${recording === id ? 'recording' : ''}`}
            onClick={() => void record(id)}
            title={recording === id ? 'Press the new shortcut, or Esc to cancel' : 'Click to record a new shortcut'}
          >
            {recording === id ? 'Press keys…' : current ? formatAccelerator(current) : 'None'}
          </button>
          <button
            type="button"
            className="ghost small"
            disabled={isDefault || recording !== undefined}
            onClick={() => void set(id, null)}
            title={`Back to ${formatAccelerator(commandById(id).accelerator)}`}
          >
            Reset
          </button>
          <button
            type="button"
            className="ghost small"
            disabled={!current || recording !== undefined}
            onClick={() => void set(id, '')}
          >
            Remove
          </button>
        </div>
        {mine?.kind === 'error' && <p className="shortcut-notice">{mine.text}</p>}
        {mine?.kind === 'conflict' && (
          <p className="shortcut-notice">
            {formatAccelerator(mine.value ?? commandById(id).accelerator)} is used by{' '}
            {commandById(mine.other).label.replace(/…$/, '')}.{' '}
            <button type="button" className="link" onClick={() => void set(id, mine.value, mine.other)}>
              Use it here instead
            </button>{' '}
            <button type="button" className="link" onClick={() => setNotice(undefined)}>
              Cancel
            </button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="shortcuts">
      {COMMAND_GROUPS.map((group) => (
        <div key={group.title} className="shortcut-group">
          <h4>{group.title}</h4>
          {group.ids.map(renderRow)}
        </div>
      ))}
    </div>
  );
}
