// Shortcuts: turning a recorded key press into an Electron accelerator, and
// checking it against the other commands. Pure, so it runs in unit tests.

import { COMMANDS, commandById, type CommandId } from './commands';
import type { Settings } from './model';

/** A key press as Electron's before-input-event reports it. */
export interface KeyInput {
  key: string;
  code: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
}

/** The command's shortcut: your setting, or the default. Undefined when unbound ("" in settings.json). */
export function acceleratorFor(settings: Settings, id: CommandId): string | undefined {
  const custom = settings.shortcuts[id];
  if (custom !== undefined) return custom || undefined;
  return commandById(id).accelerator;
}

/** Keys named by their position (event.code), for keys whose character changes with Shift or Option. */
const CODE_KEYS: Record<string, string> = {
  Enter: 'Return',
  NumpadEnter: 'Return',
  Tab: 'Tab',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
};

const NUMPAD_KEYS: Record<string, string> = {
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
};

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn', 'OS']);

/** US-layout Shift pairs: Electron reads "CmdOrCtrl+!" as ⌘⇧1, so both spellings name one shortcut. */
const SHIFTED: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  plus: '=',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
  '~': '`',
};

/**
 * Combos the system or the Edit menu needs: quit, hide, minimize, copy and
 * paste, undo, select all, and Settings itself.
 */
const RESERVED = [
  'CmdOrCtrl+Q',
  'CmdOrCtrl+Shift+Q', // Apple menu > Log Out
  'CmdOrCtrl+H',
  'CmdOrCtrl+Alt+H',
  'CmdOrCtrl+M',
  'CmdOrCtrl+C',
  'CmdOrCtrl+V',
  'CmdOrCtrl+X',
  'CmdOrCtrl+A',
  'CmdOrCtrl+Z',
  'CmdOrCtrl+Shift+Z',
  'CmdOrCtrl+,',
  'CmdOrCtrl+Ctrl+F', // View > Enter Full Screen
  'CmdOrCtrl+R', // View > Reload (development builds)
  'CmdOrCtrl+Alt+I', // View > Toggle Developer Tools (development builds)
  // Taken by macOS before any app sees them: app and window switching,
  // Spotlight and input sources, screenshots, lock screen, Force Quit, emoji, the Dock.
  'CmdOrCtrl+Tab',
  'CmdOrCtrl+Shift+Tab',
  'CmdOrCtrl+Space',
  'CmdOrCtrl+Alt+Space',
  'CmdOrCtrl+`',
  'CmdOrCtrl+Shift+`',
  'CmdOrCtrl+Shift+3',
  'CmdOrCtrl+Shift+4',
  'CmdOrCtrl+Shift+5',
  'CmdOrCtrl+Ctrl+Q',
  'CmdOrCtrl+Alt+Escape',
  'CmdOrCtrl+Ctrl+Space',
  'CmdOrCtrl+Alt+D',
];

/** Keys that move the cursor or delete in a text field. */
const TEXT_EDITING_KEYS = new Set(['left', 'right', 'up', 'down', 'home', 'end', 'pageup', 'pagedown', 'backspace', 'delete']);

/**
 * Whether a shortcut is on a key text fields use (⌘← to the start of the
 * line, ⌘⌫ to delete it). Those shortcuts aren't put on the menu bar, which
 * on macOS would take them from text fields too; the window runs them itself,
 * only when focus isn't in a text field (the terminal doesn't count).
 */
export function editsText(accelerator: string): boolean {
  return TEXT_EDITING_KEYS.has(canonical(accelerator).split('+').at(-1) ?? '');
}

/** The command a key press runs, among those whose shortcut is on a text-editing key. */
export function textKeyCommand(settings: Settings, input: KeyInput): CommandId | undefined {
  const r = acceleratorFromInput(input);
  if (!r || !('accelerator' in r) || !editsText(r.accelerator)) return undefined;
  return COMMANDS.find((c) => {
    const accel = acceleratorFor(settings, c.id);
    return accel !== undefined && sameAccelerator(accel, r.accelerator);
  })?.id;
}

export type RecordResult = { accelerator: string } | { error: string };

/**
 * The accelerator for a recorded key press. Undefined for a press of a
 * modifier alone (keep waiting for the real key). Every shortcut needs ⌘, so
 * a recorded shortcut never takes keys away from the terminal.
 */
export function acceleratorFromInput(input: KeyInput): RecordResult | undefined {
  if (MODIFIER_KEYS.has(input.key)) return undefined;
  let key: string | undefined;
  // The macOS menu matches shortcuts by the character a key types, so keys are
  // recorded by character where the character is the key's own: letters and
  // digits always, punctuation unless Shift or Option changed it. Otherwise
  // the key's position is used, read as a US layout.
  const plain = !input.shift && !input.alt;
  if (input.code === 'NumpadEnter') key = 'Return';
  else if (input.code.startsWith('Numpad')) key = NUMPAD_KEYS[input.code] ?? (/^Numpad[0-9]$/.test(input.code) ? `num${input.code.slice(6)}` : undefined);
  else if (/^[a-z0-9]$/i.test(input.key)) key = input.key.toUpperCase();
  else if (plain && input.key === '+') key = 'Plus'; // "+" separates parts of an accelerator
  else if (plain && /^[!-/:-@[-`{-~]$/.test(input.key)) key = input.key;
  else if (/^Key[A-Z]$/.test(input.code)) key = input.code.slice(3);
  else if (/^Digit[0-9]$/.test(input.code)) key = input.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(input.code)) key = input.code;
  else key = CODE_KEYS[input.code];
  if (!key) return { error: "That key can't be used in a shortcut." };
  if (!input.meta) return { error: 'Shortcuts need ⌘, so they never take keys away from the terminal.' };
  const parts = ['CmdOrCtrl'];
  if (input.control) parts.push('Ctrl');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');
  const accelerator = [...parts, key].join('+');
  if (RESERVED.some((r) => sameAccelerator(r, accelerator))) return { error: 'macOS or the Edit menu already uses that one.' };
  return { accelerator };
}

const MODIFIER_ALIASES: Record<string, string> = {
  cmdorctrl: 'cmd',
  commandorcontrol: 'cmd',
  command: 'cmd',
  cmd: 'cmd',
  super: 'cmd',
  meta: 'cmd',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
};
const KEY_ALIASES: Record<string, string> = { enter: 'return', esc: 'escape' };

/** A comparable form: modifiers by their canonical name in a fixed order, then the key. */
function canonical(accel: string): string {
  const parts = accel.split('+').map((p) => p.trim().toLowerCase());
  // "CmdOrCtrl++" and "Plus" both name the + key.
  const rawKey = accel.endsWith('++') ? 'plus' : (parts.at(-1) ?? '');
  let key = KEY_ALIASES[rawKey] ?? rawKey;
  const mods = new Set(parts.slice(0, -1).filter(Boolean).map((p) => MODIFIER_ALIASES[p] ?? p));
  const base = SHIFTED[key];
  if (base !== undefined) {
    key = base;
    mods.add('shift');
  }
  return [...[...mods].sort(), key].join('+');
}

export function sameAccelerator(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

/** The other command that already uses `accelerator`, if any. */
export function conflictFor(settings: Settings, id: CommandId, accelerator: string): CommandId | undefined {
  return COMMANDS.find((c) => {
    if (c.id === id) return false;
    const other = acceleratorFor(settings, c.id);
    return other !== undefined && sameAccelerator(other, accelerator);
  })?.id;
}

/** Key names Electron accepts after the modifiers, besides letters, digits, F-keys and single punctuation. */
const NAMED_KEYS = new Set(
  [
    'Plus', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter', 'Up', 'Down', 'Left', 'Right',
    'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc',
    'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9',
    'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
  ].map((k) => k.toLowerCase()),
);
const MODIFIER_NAMES = new Set(Object.keys(MODIFIER_ALIASES));

/**
 * Why a shortcut from settings.json can't be used, or undefined if it can.
 * The same rules as recording one: a real key, with ⌘, not one macOS or the
 * Edit menu needs.
 */
export function shortcutProblem(accelerator: string): string | undefined {
  const parts = accelerator.split('+');
  const key = accelerator.endsWith('++') ? 'Plus' : (parts.at(-1) ?? '');
  const mods = (accelerator.endsWith('++') ? parts.slice(0, -2) : parts.slice(0, -1)).map((p) => p.trim().toLowerCase());
  if (!mods.every((m) => MODIFIER_NAMES.has(m))) return 'unknown modifier';
  const validKey =
    /^[a-z0-9]$/i.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/i.test(key) || /^[!-/:-@[-`{-~]$/.test(key) || NAMED_KEYS.has(key.toLowerCase());
  if (!validKey) return 'unknown key';
  if (!mods.some((m) => MODIFIER_ALIASES[m] === 'cmd')) return 'needs ⌘';
  if (RESERVED.some((r) => sameAccelerator(r, accelerator))) return 'used by macOS or the Edit menu';
  return undefined;
}

/**
 * Shortcuts from settings.json made safe to install in the menu: unusable
 * ones fall back to the default, and no two commands end up with the same
 * shortcut. One you set beats a default (the default's command is left
 * without one); between two you set, the command listed first keeps it.
 */
export function cleanShortcuts(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  const claim = (accelerator: string) => {
    const key = canonical(accelerator);
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  };
  for (const { id } of COMMANDS) {
    const value = raw[id];
    if (value === undefined) continue;
    if (value === '') out[id] = '';
    else if (shortcutProblem(value) === undefined) out[id] = claim(value) ? value : '';
  }
  for (const { id, accelerator } of COMMANDS) {
    if (out[id] === undefined && !claim(accelerator)) out[id] = '';
  }
  return out;
}
