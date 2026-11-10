const KEY_SYMBOLS: Record<string, string> = {
  cmdorctrl: '⌘',
  commandorcontrol: '⌘',
  cmd: '⌘',
  command: '⌘',
  super: '⌘',
  meta: '⌘',
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
  plus: '+',
  pageup: '⇞',
  pagedown: '⇟',
  home: '↖',
  end: '↘',
  numadd: 'Num +',
  numsub: 'Num −',
  nummult: 'Num ×',
  numdiv: 'Num ÷',
  numdec: 'Num .',
};

/** A button's tooltip: its name and, if it has one, its shortcut ("Edit task  ⌘E"). */
export function tip(label: string, key: string): string {
  return key ? `${label}  ${key}` : label;
}

/** "CmdOrCtrl+Shift+T" -> ["⌘", "⇧", "T"], one entry per key cap. */
export function acceleratorKeys(accel: string | undefined): string[] {
  if (!accel) return [];
  // A trailing "+" is the Plus key itself ("CmdOrCtrl++").
  const parts = accel.endsWith('++') ? [...accel.slice(0, -2).split('+'), '+'] : accel.split('+');
  return parts.map((part) => {
    const p = part.toLowerCase();
    return KEY_SYMBOLS[p] ?? (/^num\d$/.test(p) ? `Num ${p.slice(3)}` : part.toUpperCase());
  });
}

/** "CmdOrCtrl+Shift+T" -> "⌘⇧T" */
export function formatAccelerator(accel: string | undefined): string {
  return acceleratorKeys(accel).join('');
}

/** Time since `since`: "40s", "12m", "1h 05m", "2d", "2w", "1mo". */
export function formatWait(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  if (d < 30) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** How long something has run: 40s, 4m 12s, 1h 05m. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** A command's menu label as the settings screen shows it: "Show Next Tab…" -> "Show next tab". */
export function sentenceCase(label: string): string {
  const words = label.replace(/…$/, '').split(' ');
  return words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(' ');
}

/** Splits text into plain runs and http(s) links, for showing a description with clickable links. */
export function linkify(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"`]+/g)) {
    // Punctuation that ends a sentence isn't part of the link, nor is a
    // closing bracket with no opening one in the link: "(see https://x.y)".
    let url = m[0];
    for (;;) {
      const end = url.at(-1)!;
      const open = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[end];
      const count = (c: string) => url.split(c).length - 1;
      if (/[.,;:!?'"]/.test(end) || (open && count(end) > count(open))) url = url.slice(0, -1);
      else break;
    }
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: url, href: url });
    last = m.index + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function shortenHome(dir: string | undefined, home: string): string | undefined {
  if (!dir) return undefined;
  return dir === home || dir.startsWith(home + '/') ? '~' + dir.slice(home.length) : dir;
}

/** Single-quotes a path for zsh, so spaces and symbols in it are taken literally. */
export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
