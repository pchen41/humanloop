// The four themes (design/SPEC.md, Tokens). The renderer's CSS has one
// variable block per theme; this module names them and picks the one in use.

export type Appearance = 'system' | 'light' | 'dark';
export type DarkTheme = 'graphite' | 'dusk';
export type LightTheme = 'paper' | 'linen';
export type ThemeName = DarkTheme | LightTheme;

export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];
export const DARK_THEMES: readonly DarkTheme[] = ['graphite', 'dusk'];
export const LIGHT_THEMES: readonly LightTheme[] = ['paper', 'linen'];

export const THEME_LABELS: Record<ThemeName, string> = {
  graphite: 'Graphite',
  dusk: 'Dusk',
  paper: 'Paper',
  linen: 'Linen',
};

/** The theme in use: the chosen dark or light one, by the appearance setting (or macOS's, for System). */
export function resolveTheme(
  s: { appearance: Appearance; darkTheme: DarkTheme; lightTheme: LightTheme },
  systemIsDark: boolean,
): ThemeName {
  const dark = s.appearance === 'dark' || (s.appearance === 'system' && systemIsDark);
  return dark ? s.darkTheme : s.lightTheme;
}

export function isDarkTheme(t: ThemeName): boolean {
  return (DARK_THEMES as readonly string[]).includes(t);
}

/** The window background (bg/window), for the native window behind the page. */
export const WINDOW_COLORS: Record<ThemeName, string> = {
  graphite: '#111113',
  dusk: '#1A1D24',
  paper: '#F5F5F7',
  linen: '#F4F0E7',
};

/** The colours a theme card's small preview is drawn in. */
export interface ThemePreview {
  window: string;
  chrome: string;
  line: string;
  bar: string;
  fg: string;
  you: string;
  agent: string;
  shell: string;
}

export const THEME_PREVIEWS: Record<ThemeName, ThemePreview> = {
  graphite: { window: '#111113', chrome: '#17171a', line: '#222227', bar: '#3b3b44', fg: '#8a8a95', you: '#6fd2b0', agent: '#e6b450', shell: '#5a5a66' },
  dusk: { window: '#1a1d24', chrome: '#20242c', line: '#2c313b', bar: '#444b5b', fg: '#8a91a0', you: '#7cd4b6', agent: '#e2b35c', shell: '#646c7c' },
  paper: { window: '#f5f5f7', chrome: '#ececef', line: '#d9d9de', bar: '#c9c9d0', fg: '#5a5a66', you: '#147c5a', agent: '#b4780c', shell: '#a0a0aa' },
  linen: { window: '#f4f0e7', chrome: '#ece7db', line: '#ddd6c8', bar: '#cdc4b3', fg: '#5e5649', you: '#1e7a58', agent: '#a5680a', shell: '#a89f8f' },
};
