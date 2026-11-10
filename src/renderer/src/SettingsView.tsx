import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../shared/model';
import { shortenHome } from './format';
import { PolicyControls } from './PolicyControls';
import { ShortcutsSection } from './ShortcutsSection';
import {
  APPEARANCES,
  DARK_THEMES,
  LIGHT_THEMES,
  THEME_LABELS,
  THEME_PREVIEWS,
  type DarkTheme,
  type LightTheme,
  type ThemeName,
} from '../../shared/themes';

const api = window.humanloop;

interface Props {
  settings: Settings;
  homeDir: string;
  /** Saves a directory typed but not yet confirmed; called as Settings closes. */
  flushRef: React.RefObject<(() => void) | undefined>;
}

const SECTIONS = [
  { id: 'appearance', title: 'Appearance' },
  { id: 'turn', title: 'Turn rules' },
  { id: 'tabs', title: 'Tabs' },
  { id: 'notifications', title: 'Notifications & power' },
  { id: 'shortcuts', title: 'Keyboard shortcuts' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** Settings, in the main column. Changes apply as you make them; there is no Save. */
export function SettingsView({ settings, homeDir, flushRef }: Props) {
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
  const [current, setCurrent] = useState<SectionId>(SECTIONS[0].id);
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
        <section className="sec" id="section-appearance" aria-labelledby="settings-appearance">
          <h2 id="settings-appearance">Appearance</h2>
          <p className="lead">Themes change colours only. Layout, shapes and what each colour means stay the same.</p>
          <div className="srow">
            <div className="t">
              <b id="settings-appearance-mode">Theme</b>
              <span className="help">System follows macOS, switching between the dark and light themes chosen below.</span>
            </div>
            <div className="seg" role="radiogroup" aria-labelledby="settings-appearance-mode">
              {APPEARANCES.map((a) => (
                <button
                  type="button"
                  key={a}
                  role="radio"
                  aria-checked={settings.appearance === a}
                  className={settings.appearance === a ? 'on' : ''}
                  onClick={() => void api.updateSettings({ appearance: a })}
                >
                  {a === 'system' ? 'System' : a === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>
          <div className="srow top">
            <div className="t">
              <b id="settings-dark-theme">Dark theme</b>
            </div>
            <ThemeCards
              labelledBy="settings-dark-theme"
              themes={DARK_THEMES}
              chosen={settings.darkTheme}
              onChoose={(t) => void api.updateSettings({ darkTheme: t as DarkTheme })}
            />
          </div>
          <div className="srow top">
            <div className="t">
              <b id="settings-light-theme">Light theme</b>
            </div>
            <ThemeCards
              labelledBy="settings-light-theme"
              themes={LIGHT_THEMES}
              chosen={settings.lightTheme}
              onChoose={(t) => void api.updateSettings({ lightTheme: t as LightTheme })}
            />
          </div>
        </section>

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
              <b>Notify me when a task needs my attention</b>
              <span className="help">Only while Humanloop is in the background.</span>
            </div>
            <Toggle
              label="Notify me when a task needs my attention"
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

/** Theme cards: a small preview drawn in each theme's own colours, as a radio group. */
function ThemeCards(props: { labelledBy: string; themes: readonly ThemeName[]; chosen: ThemeName; onChoose(t: ThemeName): void }) {
  return (
    <div className="theme-cards" role="radiogroup" aria-labelledby={props.labelledBy}>
      {props.themes.map((t) => {
        const c = THEME_PREVIEWS[t];
        const on = t === props.chosen;
        return (
          <button
            type="button"
            key={t}
            role="radio"
            aria-checked={on}
            className={`theme-card${on ? ' on' : ''}`}
            onClick={() => props.onChoose(t)}
          >
            <span
              className="pv"
              aria-hidden
              style={{ background: c.window, borderColor: c.line, ['--bar' as string]: c.bar, ['--fg' as string]: c.fg, ['--nx' as string]: c.you }}
            >
              <span className="pv-side" style={{ background: c.chrome, borderColor: c.line }}>
                <i style={{ ['--dot' as string]: c.you }} />
                <i style={{ ['--dot' as string]: c.agent }} />
                <i className="o" style={{ ['--dot' as string]: c.shell }} />
              </span>
              <span className="pv-main">
                <span className="hd">
                  <i className="tt" />
                  <b />
                </span>
                <span className="tb" />
                <i style={{ width: '70%' }} />
                <i style={{ width: '48%' }} />
                <i style={{ width: '82%' }} />
                <i style={{ width: '36%' }} />
              </span>
            </span>
            <span className="nm">{THEME_LABELS[t]}</span>
          </button>
        );
      })}
    </div>
  );
}
