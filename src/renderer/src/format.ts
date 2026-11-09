const KEY_SYMBOLS: Record<string, string> = {
  cmdorctrl: '⌘',
  commandorcontrol: '⌘',
  cmd: '⌘',
  command: '⌘',
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  return: '↩',
  enter: '↩',
  backspace: '⌫',
  delete: '⌦',
  escape: '⎋',
  esc: '⎋',
  tab: '⇥',
  space: 'Space',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

/** "CmdOrCtrl+Shift+T" -> "⌘⇧T" */
export function formatAccelerator(accel: string | undefined): string {
  if (!accel) return '';
  return accel
    .split('+')
    .map((part) => KEY_SYMBOLS[part.toLowerCase()] ?? part.toUpperCase())
    .join('');
}

/** Compact time since `since`: "now", "4m", "3h", "2d". */
export function formatWait(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function shortenHome(dir: string | undefined, home: string): string | undefined {
  if (!dir) return undefined;
  return dir === home || dir.startsWith(home + '/') ? '~' + dir.slice(home.length) : dir;
}

/** Single-quotes a path for zsh, so spaces and symbols in it are taken literally. */
export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
