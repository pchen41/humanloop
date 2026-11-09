import { useEffect, useState, type KeyboardEvent } from 'react';
import type { HookState } from '../../shared/ipc';
import type { Settings } from '../../shared/model';
import { shortenHome } from './format';
import { PolicyControls } from './PolicyControls';

const api = window.humanloop;

interface Props {
  settings: Settings;
  hooks: HookState;
  homeDir: string;
  onClose(): void;
}

const HOOK_TEXT: Record<HookState, string> = {
  installed: 'Installed. Claude sessions in Humanloop tabs report what they are doing.',
  outdated: 'Out of date. Update them so every event reaches Humanloop.',
  missing: "Not installed. Without them Humanloop can't tell when Claude is working or waiting.",
  unreadable: "~/.claude/settings.json can't be read, so Humanloop can't check its hooks.",
};

/** Settings apply as you change them; there is no Save. */
export function SettingsView({ settings, hooks, homeDir, onClose }: Props) {
  const [cwd, setCwd] = useState(settings.defaultCwd ?? '');
  // Follow changes made elsewhere (e.g. editing settings.json by hand).
  useEffect(() => setCwd(settings.defaultCwd ?? ''), [settings.defaultCwd]);

  const saveCwd = (value: string) => {
    if (value.trim() !== (settings.defaultCwd ?? '')) void api.updateSettings({ defaultCwd: value.trim() || null });
  };

  async function chooseDir() {
    const dir = await api.chooseDirectory(settings.defaultCwd);
    if (dir) {
      setCwd(dir);
      void api.updateSettings({ defaultCwd: dir });
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings" role="dialog" aria-label="Settings" onKeyDown={onKeyDown} tabIndex={-1}>
        <h2>Settings</h2>

        <section>
          <h3>When is it your turn?</h3>
          <p className="section-hint">
            A task moves to Your Turn when Claude is done or needs you. These decide what counts as done. Each task can
            override them.
          </p>
          <PolicyControls
            value={settings.policy}
            onChange={(key, value) => value !== undefined && void api.updateSettings({ policy: { [key]: value } })}
          />
        </section>

        <section>
          <h3>New tabs</h3>
          <div className="field">
            <span>Default directory</span>
            <div className="row">
              <input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                onBlur={(e) => saveCwd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveCwd(cwd)}
                placeholder={shortenHome(homeDir, homeDir) ?? '~'}
                spellCheck={false}
              />
              <button type="button" onClick={chooseDir}>
                Choose…
              </button>
            </div>
            <small>Used by tasks that don't set their own.</small>
          </div>
        </section>

        <section>
          <h3>While you're away</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={(e) => void api.updateSettings({ notifications: e.target.checked })}
            />
            <span>
              Notify me when a task comes back to Your Turn
              <small>Only while Humanloop isn't the active app. Clicking the notification opens the task.</small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.keepAwake}
              onChange={(e) => void api.updateSettings({ keepAwake: e.target.checked })}
            />
            <span>
              Keep the Mac awake while Claude is working
              <small>Stops idle sleep while Claude is working in any task. Closing the lid still puts the Mac to sleep.</small>
            </span>
          </label>
        </section>

        <section>
          <h3>Claude Code hooks</h3>
          <p className={`section-hint hooks-${hooks}`}>{HOOK_TEXT[hooks]}</p>
          <div className="row-buttons">
            {hooks !== 'installed' && (
              <button type="button" className={hooks === 'missing' ? 'primary' : ''} onClick={() => void api.installHooks()}>
                {hooks === 'outdated' ? 'Update Hooks…' : 'Install Hooks…'}
              </button>
            )}
            {(hooks === 'installed' || hooks === 'outdated') && (
              <button type="button" onClick={() => void api.removeHooks()}>
                Remove Hooks…
              </button>
            )}
          </div>
        </section>

        <section>
          <h3>Shortcuts</h3>
          <p className="section-hint">Shortcuts are set in Humanloop's settings.json and apply as soon as you save it.</p>
          <div className="row-buttons">
            <button type="button" onClick={() => api.openSettingsFile()}>
              Open settings.json
            </button>
          </div>
        </section>

        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
