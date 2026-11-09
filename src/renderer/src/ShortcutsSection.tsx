import { useEffect, useState } from 'react';
import { COMMAND_GROUPS, commandById, type CommandId } from '../../shared/commands';
import type { Settings } from '../../shared/model';
import { acceleratorFor, sameAccelerator } from '../../shared/shortcuts';
import { acceleratorKeys, formatAccelerator, sentenceCase } from './format';

const api = window.humanloop;

type Notice =
  | { id: CommandId; kind: 'error'; text: string }
  /** `value` is what was being set: an accelerator, or null for the default. */
  | { id: CommandId; kind: 'conflict'; value: string | null; other: CommandId };

/** Two columns: Tasks and Terminal, then Tabs (the longest group) on its own. */
const COLUMNS: string[][] = [['Tasks', 'Terminal'], ['Tabs']];

const label = (id: CommandId) => sentenceCase(commandById(id).label);

/** Every command's shortcut, with record, Reset and Remove. Changes save at once. */
export function ShortcutsSection({ settings }: { settings: Settings }) {
  const [recording, setRecording] = useState<CommandId>();
  const [notice, setNotice] = useState<Notice>();

  // Stop listening if the screen closes mid-recording.
  useEffect(() => () => api.stopRecording(), []);

  // Esc dismisses a clash or error line, before it could close Settings.
  useEffect(() => {
    if (!notice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setNotice(undefined);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [notice]);

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

  const changed = Object.keys(settings.shortcuts);

  function renderRow(id: CommandId) {
    const name = label(id);
    const current = acceleratorFor(settings, id);
    const fallback = commandById(id).accelerator;
    const isDefault = sameAccelerator(current ?? '', fallback);
    const isRecording = recording === id;
    const mine = notice?.id === id ? notice : undefined;
    // While a clash waits for an answer, the row shows the keys you pressed.
    const pending = mine?.kind === 'conflict' ? (mine.value ?? fallback) : undefined;
    const keys = acceleratorKeys(pending ?? current);
    return (
      <div key={id}>
        <div className={`shortcut-row ${isRecording || pending ? 'recording' : ''}`}>
          <span className="shortcut-name">{name}</span>
          <span className="shortcut-actions">
            {!isDefault && (
              <button
                type="button"
                className="btn sm"
                disabled={recording !== undefined}
                onClick={() => void set(id, null)}
                title={`Back to ${formatAccelerator(fallback)}`}
              >
                Reset
              </button>
            )}
            {current && (
              <button type="button" className="btn sm" disabled={recording !== undefined} onClick={() => void set(id, '')}>
                Remove
              </button>
            )}
          </span>
          {!isDefault && !isRecording && !pending && <span className="changed-dot" title={`Changed from ${formatAccelerator(fallback)}`} />}
          <button
            type="button"
            className={`keys ${isRecording ? 'recording' : ''}`}
            onClick={() => void record(id)}
            aria-label={
              isRecording ? `Recording a shortcut for ${name}. Press the new keys, or Esc to cancel.` : `${name}: ${formatAccelerator(current) || 'none'}. Click to change.`
            }
          >
            {isRecording ? (
              <>
                Press keys
                <span className="caret" aria-hidden />
              </>
            ) : keys.length ? (
              keys.map((k, i) => (
                <span key={i} className="cap">
                  {k}
                </span>
              ))
            ) : (
              <span className="none">None</span>
            )}
          </button>
        </div>
        {mine?.kind === 'error' && (
          <div className="shortcut-notice" role="alert">
            <span>{mine.text}</span>
            <button type="button" className="btn sm" onClick={() => setNotice(undefined)}>
              OK
            </button>
          </div>
        )}
        {mine?.kind === 'conflict' && (
          <div className="shortcut-notice" role="alert">
            <span>Used by {label(mine.other)}.</span>
            <button type="button" className="btn sm link" onClick={() => void set(id, mine.value, mine.other)}>
              Reassign
            </button>
            <button type="button" className="btn sm" onClick={() => setNotice(undefined)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="shortcuts-head">
        <div>
          <h2 id="settings-shortcuts">Keyboard shortcuts</h2>
          <p className="help">Click a shortcut, then press the new keys. Esc cancels.</p>
        </div>
        <button type="button" className="btn solid" onClick={() => api.openSettingsFile()}>
          Open settings.json
        </button>
        <button
          type="button"
          className="btn solid"
          disabled={!changed.length || recording !== undefined}
          onClick={() => {
            setNotice(undefined);
            void api.updateSettings({ shortcuts: Object.fromEntries(changed.map((id) => [id, null])) });
          }}
        >
          Reset all
        </button>
      </div>
      <div className="shortcut-columns">
        {COLUMNS.map((titles, i) => (
          <div key={i} className="shortcut-column">
            {COMMAND_GROUPS.filter((g) => titles.includes(g.title)).map((group) => (
              <div key={group.title} className="shortcut-group">
                <h3>{group.title}</h3>
                {group.ids.map(renderRow)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
