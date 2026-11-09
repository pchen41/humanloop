import { useEffect, useRef, useState } from 'react';
import type { HookState } from '../../shared/ipc';
import type { Settings } from '../../shared/model';
import { shortenHome } from './format';
import { PolicyControls } from './PolicyControls';
import { ShortcutsSection } from './ShortcutsSection';

const api = window.humanloop;

interface Props {
  settings: Settings;
  hooks: HookState;
  /** Claude Code's settings.json, where the hooks go. */
  claudeSettingsPath: string;
  homeDir: string;
  /** Saves a directory typed but not yet confirmed; called as Settings closes. */
  flushRef: React.RefObject<(() => void) | undefined>;
}

const SECTIONS = [
  { id: 'turn', title: 'Turn rules' },
  { id: 'tabs', title: 'Tabs' },
  { id: 'notifications', title: 'Notifications & power' },
  { id: 'claude', title: 'Claude Code' },
  { id: 'shortcuts', title: 'Keyboard shortcuts' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const HOOKS: Record<HookState, { pill: string; tone: 'ok' | 'warn' | 'off'; title: string; help: string }> = {
  installed: {
    pill: 'Installed',
    tone: 'ok',
    title: 'Hooks installed',
    help: 'Claude sessions in Humanloop tabs report when they are working or waiting.',
  },
  outdated: {
    pill: 'Out of date',
    tone: 'warn',
    title: 'Hooks out of date',
    help: 'Update them so every event reaches Humanloop.',
  },
  missing: {
    pill: 'Not installed',
    tone: 'off',
    title: 'Hooks not installed',
    help: "Without them Humanloop can't tell when Claude is working or waiting.",
  },
  unreadable: {
    pill: "Can't read",
    tone: 'warn',
    title: "settings.json can't be read",
    help: "Humanloop can't check its hooks until the file is valid JSON again.",
  },
  disabled: {
    pill: 'Turned off',
    tone: 'warn',
    title: 'Hooks turned off',
    help: "Installed, but Claude Code's settings (yours or your organisation's) turn hooks off, so they don't run.",
  },
};

/** Settings, in the main column. Changes apply as you make them; there is no Save. */
export function SettingsView({ settings, hooks, claudeSettingsPath, homeDir, flushRef }: Props) {
  const [cwd, setCwd] = useState(settings.defaultCwd ?? '');
  // Follow changes made elsewhere (e.g. editing settings.json by hand).
  useEffect(() => setCwd(settings.defaultCwd ?? ''), [settings.defaultCwd]);

  const saveCwd = (value: string) => {
    if (value.trim() !== (settings.defaultCwd ?? '')) void api.updateSettings({ defaultCwd: value.trim() || null });
  };
  flushRef.current = () => saveCwd(cwd);

  async function chooseDir() {
    const dir = await api.chooseDirectory(settings.defaultCwd);
    if (dir) {
      setCwd(dir);
      void api.updateSettings({ defaultCwd: dir });
    }
  }

  // The nav marks the section at the top of the scrolled content.
  const content = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<SectionId>('turn');
  const onScroll = () => {
    const el = content.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + 40;
    let seen: SectionId = 'turn';
    for (const { id } of SECTIONS) {
      const sec = el.querySelector(`#section-${id}`);
      if (sec && sec.getBoundingClientRect().top <= top) seen = id;
    }
    setCurrent(seen);
  };
  const go = (id: SectionId) => {
    content.current?.querySelector(`#section-${id}`)?.scrollIntoView({ block: 'start' });
    setCurrent(id);
  };

  const hook = HOOKS[hooks];

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {SECTIONS.map(({ id, title }) => (
          <button key={id} className={current === id ? 'on' : ''} aria-current={current === id || undefined} onClick={() => go(id)}>
            {title}
          </button>
        ))}
      </nav>

      <div className="settings-content" ref={content} onScroll={onScroll}>
        <section className="sec" id="section-turn" aria-labelledby="settings-turn">
          <h2 id="settings-turn">Turn rules</h2>
          <p className="lead">When a task comes back to you. Tasks can override these.</p>
          <PolicyControls
            value={settings.policy}
            onChange={(key, value) => value !== undefined && void api.updateSettings({ policy: { [key]: value } })}
          />
        </section>

        <section className="sec" id="section-tabs" aria-labelledby="settings-tabs">
          <h2 id="settings-tabs">Tabs</h2>
          <div className="srow">
            <div className="t">
              <b>Open new tabs in the current tab's directory</b>
              <span className="help">Otherwise new tabs use the task's directory, or the default below.</span>
            </div>
            <Toggle
              label="Open new tabs in the current tab's directory"
              on={settings.newTabsInCurrentDir}
              onChange={(on) => void api.updateSettings({ newTabsInCurrentDir: on })}
            />
          </div>
          <div className="srow">
            <div className="t">
              <label htmlFor="settings-dir">Default directory</label>
            </div>
            <div className="dir-control">
              <input
                id="settings-dir"
                className="in mono"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                onBlur={(e) => saveCwd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveCwd(cwd)}
                placeholder={shortenHome(homeDir, homeDir) ?? '~'}
                spellCheck={false}
              />
              <button type="button" className="btn solid" onClick={() => void chooseDir()}>
                Choose…
              </button>
            </div>
          </div>
          <div className="srow">
            <div className="t">
              <b>Use Option as Meta</b>
              <span className="help">For zsh word movement like Option+←. Turn it off if Option types characters such as @ {'{'} [ | on your keyboard.</span>
            </div>
            <Toggle label="Use Option as Meta" on={settings.optionAsMeta} onChange={(on) => void api.updateSettings({ optionAsMeta: on })} />
          </div>
        </section>

        <section className="sec" id="section-notifications" aria-labelledby="settings-notifications">
          <h2 id="settings-notifications">Notifications &amp; power</h2>
          <div className="srow">
            <div className="t">
              <b>Notify me when a task comes back to me</b>
              <span className="help">Only while Humanloop is in the background.</span>
            </div>
            <Toggle
              label="Notify me when a task comes back to me"
              on={settings.notifications}
              onChange={(on) => void api.updateSettings({ notifications: on })}
            />
          </div>
          <div className="srow">
            <div className="t">
              <b>Keep the Mac awake while Claude is working</b>
            </div>
            <Toggle
              label="Keep the Mac awake while Claude is working"
              on={settings.keepAwake}
              onChange={(on) => void api.updateSettings({ keepAwake: on })}
            />
          </div>
        </section>

        <section className="sec" id="section-claude" aria-labelledby="settings-claude">
          <h2 id="settings-claude">Claude Code</h2>
          <p className="lead">
            Humanloop reads Claude's state through a hook in <span className="mono">{claudeSettingsPath}</span>.
          </p>
          <div className="hook-card">
            <span className={`pill ${hook.tone}`}>{hook.pill}</span>
            <div className="t">
              <b>{hook.title}</b>
              <span className="help">{hook.help}</span>
            </div>
            {hooks !== 'installed' && hooks !== 'disabled' && (
              <button type="button" className="btn primary" onClick={() => void api.installHooks()}>
                {hooks === 'outdated' ? 'Update' : 'Install'}
              </button>
            )}
            {(hooks === 'installed' || hooks === 'outdated' || hooks === 'disabled') && (
              <button type="button" className="btn danger" onClick={() => void api.removeHooks()}>
                Remove
              </button>
            )}
          </div>
        </section>

        <section className="sec wide" id="section-shortcuts" aria-labelledby="settings-shortcuts">
          <ShortcutsSection settings={settings} />
        </section>
      </div>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange(on: boolean): void }) {
  return <button type="button" className={`tg ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}
