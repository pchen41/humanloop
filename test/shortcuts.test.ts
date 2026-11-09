import { describe, expect, it } from 'vitest';
import { COMMAND_GROUPS, COMMANDS } from '../src/shared/commands';
import { DEFAULT_SETTINGS, patchSettingsJson } from '../src/shared/model';
import { normalizeSettings } from '../src/shared/normalize';
import {
  acceleratorFor,
  acceleratorFromInput,
  conflictFor,
  sameAccelerator,
  shortcutProblem,
  type KeyInput,
} from '../src/shared/shortcuts';

const press = (key: string, code: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key,
  code,
  meta: true,
  control: false,
  alt: false,
  shift: false,
  ...mods,
});

describe('acceleratorFromInput', () => {
  it('records ⌘ shortcuts with their modifiers in a fixed order', () => {
    expect(acceleratorFromInput(press('j', 'KeyJ'))).toEqual({ accelerator: 'CmdOrCtrl+J' });
    expect(acceleratorFromInput(press('J', 'KeyJ', { shift: true, control: true }))).toEqual({
      accelerator: 'CmdOrCtrl+Ctrl+Shift+J',
    });
    expect(acceleratorFromInput(press('Enter', 'Enter'))).toEqual({ accelerator: 'CmdOrCtrl+Return' });
    expect(acceleratorFromInput(press('F5', 'F5'))).toEqual({ accelerator: 'CmdOrCtrl+F5' });
  });

  it('names keys by position when Shift or Option changes their character', () => {
    expect(acceleratorFromInput(press('}', 'BracketRight', { shift: true }))).toEqual({ accelerator: 'CmdOrCtrl+Shift+]' });
    expect(acceleratorFromInput(press('!', 'Digit1', { shift: true }))).toEqual({ accelerator: 'CmdOrCtrl+Shift+1' });
    expect(acceleratorFromInput(press('∆', 'KeyJ', { alt: true }))).toEqual({ accelerator: 'CmdOrCtrl+Alt+J' });
  });

  it('uses the letter on the key for other layouts', () => {
    // AZERTY: the key in the Q position types A.
    expect(acceleratorFromInput(press('a', 'KeyQ'))).toMatchObject({ error: expect.any(String) }); // ⌘A is reserved
    expect(acceleratorFromInput(press('w', 'KeyZ'))).toEqual({ accelerator: 'CmdOrCtrl+W' });
  });

  it('waits through modifier presses and refuses unusable shortcuts', () => {
    expect(acceleratorFromInput(press('Meta', 'MetaLeft'))).toBeUndefined();
    expect(acceleratorFromInput(press('Shift', 'ShiftLeft', { shift: true }))).toBeUndefined();
    expect(acceleratorFromInput(press('j', 'KeyJ', { meta: false, control: true }))).toHaveProperty('error');
    expect(acceleratorFromInput(press('q', 'KeyQ'))).toHaveProperty('error');
    expect(acceleratorFromInput(press(',', 'Comma'))).toHaveProperty('error');
    expect(acceleratorFromInput(press('Dead', 'IntlBackslash'))).toHaveProperty('error');
  });
});

describe('conflicts', () => {
  it('compares accelerators regardless of spelling and modifier order', () => {
    expect(sameAccelerator('CmdOrCtrl+Shift+P', 'Command+shift+p')).toBe(true);
    expect(sameAccelerator('Cmd+Alt+J', 'Option+Cmd+J')).toBe(true);
    expect(sameAccelerator('CmdOrCtrl+Enter', 'CmdOrCtrl+Return')).toBe(true);
    expect(sameAccelerator('CmdOrCtrl+J', 'CmdOrCtrl+Shift+J')).toBe(false);
  });

  it('finds the command that already uses a shortcut', () => {
    expect(conflictFor(DEFAULT_SETTINGS, 'nextTask', 'CmdOrCtrl+N')).toBe('newTask');
    expect(conflictFor(DEFAULT_SETTINGS, 'newTask', 'CmdOrCtrl+N')).toBeUndefined();
    const unbound = { ...DEFAULT_SETTINGS, shortcuts: { newTask: '' } };
    expect(conflictFor(unbound, 'nextTask', 'CmdOrCtrl+N')).toBeUndefined();
    expect(acceleratorFor(unbound, 'newTask')).toBeUndefined();
  });
});

describe('saving shortcuts', () => {
  it('sets, removes and resets single shortcuts, keeping the rest', () => {
    const disk = { shortcuts: { newTask: 'CmdOrCtrl+N', nextTask: 'CmdOrCtrl+J' }, policy: { multiAgent: 'all' } };
    const out = patchSettingsJson(disk, { shortcuts: { find: 'CmdOrCtrl+Shift+F', newTask: '', nextTask: null, bogus: 'X' } });
    expect(out).toEqual({ ...disk, shortcuts: { newTask: '', find: 'CmdOrCtrl+Shift+F' } });
    const s = normalizeSettings(out);
    expect(acceleratorFor(s, 'nextTask')).toBe('CmdOrCtrl+Return');
    expect(acceleratorFor(s, 'newTask')).toBeUndefined();
  });
});

describe('command groups', () => {
  it('list every command exactly once', () => {
    const listed = COMMAND_GROUPS.flatMap((g) => g.ids);
    expect([...listed].sort()).toEqual(COMMANDS.map((c) => c.id).sort());
  });
});

describe('review fixes', () => {
  it('records punctuation by the character it types, unless Shift or Option changed it', () => {
    // German layout: the key in the US "/" position types "-".
    expect(acceleratorFromInput(press('-', 'Slash'))).toEqual({ accelerator: 'CmdOrCtrl+-' });
    expect(acceleratorFromInput(press('+', 'BracketRight'))).toEqual({ accelerator: 'CmdOrCtrl+Plus' });
    expect(acceleratorFromInput(press('{', 'BracketLeft', { shift: true }))).toEqual({ accelerator: 'CmdOrCtrl+Shift+[' });
  });

  it('records numpad keys and treats shifted symbols as their Shift combos', () => {
    expect(acceleratorFromInput(press('+', 'NumpadAdd'))).toEqual({ accelerator: 'CmdOrCtrl+numadd' });
    expect(acceleratorFromInput(press('1', 'Numpad1'))).toEqual({ accelerator: 'CmdOrCtrl+num1' });
    expect(sameAccelerator('CmdOrCtrl+!', 'CmdOrCtrl+Shift+1')).toBe(true);
    expect(sameAccelerator('CmdOrCtrl+Plus', 'CmdOrCtrl+Shift+=')).toBe(true);
    expect(sameAccelerator('CmdOrCtrl+}', 'CmdOrCtrl+Shift+]')).toBe(true);
    expect(sameAccelerator('CmdOrCtrl+]', 'CmdOrCtrl+Shift+]')).toBe(false);
  });

  it('reserves the full-screen shortcut', () => {
    expect(acceleratorFromInput(press('f', 'KeyF', { control: true }))).toHaveProperty('error');
  });
});

describe('shortcuts from settings.json', () => {
  it('rejects shortcuts the recorder would refuse', () => {
    expect(shortcutProblem('CmdOrCtrl+J')).toBeUndefined();
    expect(shortcutProblem('Command+Shift+]')).toBeUndefined();
    expect(shortcutProblem('CmdOrCtrl+numadd')).toBeUndefined();
    expect(shortcutProblem('Ctrl+C')).toBe('needs ⌘'); // would take SIGINT away from every shell
    expect(shortcutProblem('CmdOrCtrl+Q')).toBeTruthy();
    expect(shortcutProblem('CmdOrCtrl+Left')).toBeTruthy();
    expect(shortcutProblem('Cmd+Bogus')).toBe('unknown key');
    expect(shortcutProblem('Hyper+J')).toBe('unknown modifier');
  });

  it('falls back to the default for unusable ones and never installs a duplicate', () => {
    const s = normalizeSettings({ shortcuts: { clearTerminal: 'Ctrl+C', nextTask: 'CmdOrCtrl+N', find: 'CmdOrCtrl+J', newTab: 'CmdOrCtrl+J' } });
    expect(acceleratorFor(s, 'clearTerminal')).toBe('CmdOrCtrl+K'); // invalid -> default
    expect(acceleratorFor(s, 'nextTask')).toBe('CmdOrCtrl+N'); // yours beats a default...
    expect(acceleratorFor(s, 'newTask')).toBeUndefined(); // ...whose command is left without one
    expect(acceleratorFor(s, 'newTab')).toBe('CmdOrCtrl+J'); // listed before Find, so it keeps ⌘J
    expect(acceleratorFor(s, 'find')).toBeUndefined();
    const all = COMMANDS.map((c) => acceleratorFor(s, c.id)).filter((a): a is string => !!a);
    expect(new Set(all.map((a) => a.toLowerCase())).size).toBe(all.length);
  });
});

describe('third-round fixes', () => {
  it('records keypad Enter as Return and reserves Log Out', () => {
    expect(acceleratorFromInput(press('Enter', 'NumpadEnter'))).toEqual({ accelerator: 'CmdOrCtrl+Return' });
    expect(acceleratorFromInput(press('Q', 'KeyQ', { shift: true }))).toHaveProperty('error');
  });
});
