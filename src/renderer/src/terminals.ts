// One xterm.js terminal per tab, created when the tab is first shown and then
// kept alive while hidden, so output keeps arriving and scrollback survives
// tab and task switches. (A tab's shell starts when its terminal first attaches.)
//
// Uses xterm's default DOM renderer. @xterm/addon-webgl 0.19 with xterm 6.0
// drew glyphs at half size on Retina screens, so it is left out for now.

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { Terminal, type ITheme } from '@xterm/xterm';
import type { PtyExitInfo } from '../../shared/ipc';
import { isDarkTheme, type ThemeName } from '../../shared/themes';

const api = window.humanloop;

const GRAPHITE: ITheme = {
  background: '#131316',
  foreground: '#c2c2ca',
  cursor: '#c2c2ca',
  cursorAccent: '#131316',
  selectionBackground: '#34405a',
  black: '#2a2a30',
  red: '#f16c6c',
  green: '#6ccf9a',
  yellow: '#f2c46b',
  blue: '#7eb0ff',
  magenta: '#c58bff',
  cyan: '#6fd2b0',
  white: '#e3e3e9',
  brightBlack: '#7d7d89',
  brightRed: '#ff8a8a',
  brightGreen: '#8ee0b3',
  brightYellow: '#f7d48e',
  brightBlue: '#a1c6ff',
  brightMagenta: '#d6aaff',
  brightCyan: '#94e0c6',
  brightWhite: '#e3e3e9',
};

const DUSK: ITheme = {
  ...GRAPHITE,
  background: '#1c2027',
  foreground: '#bfc6d2',
  cursor: '#bfc6d2',
  cursorAccent: '#1c2027',
  selectionBackground: '#3a4660',
  black: '#2c313b',
  white: '#e0e5ee',
  brightBlack: '#7b8393',
  brightWhite: '#e0e5ee',
};

const PAPER: ITheme = {
  background: '#f7f7f9',
  foreground: '#3a3a44',
  cursor: '#3a3a44',
  cursorAccent: '#f7f7f9',
  selectionBackground: '#cfdcf5',
  black: '#2b2b33',
  red: '#d9453f',
  green: '#2f9e5f',
  yellow: '#8a5a00',
  blue: '#2f6fd0',
  magenta: '#8a4fd0',
  cyan: '#147c5a',
  white: '#2a2a32',
  brightBlack: '#8a8a95',
  brightRed: '#c0392f',
  brightGreen: '#26834e',
  brightYellow: '#6e4800',
  brightBlue: '#2559ad',
  brightMagenta: '#723fb0',
  brightCyan: '#0f5e44',
  brightWhite: '#2a2a32',
};

const LINEN: ITheme = {
  ...PAPER,
  background: '#f6f2ea',
  foreground: '#443e36',
  cursor: '#443e36',
  cursorAccent: '#f6f2ea',
  selectionBackground: '#e3d9c4',
  black: '#443e36',
  red: '#c9483e',
  green: '#2e8e59',
  yellow: '#85581a',
  blue: '#3568b8',
  cyan: '#1e7a58',
  white: '#2c2721',
  brightBlack: '#8c8375',
  brightWhite: '#2c2721',
};

const THEMES: Record<ThemeName, ITheme> = { graphite: GRAPHITE, dusk: DUSK, paper: PAPER, linen: LINEN };

/** Find highlights. The addon needs #RRGGBB colors. */
const DARK_SEARCH = {
  matchBackground: '#4b4320',
  matchOverviewRuler: '#8a7a3a',
  activeMatchBackground: '#a8862c',
  activeMatchColorOverviewRuler: '#f0b35e',
};
const LIGHT_SEARCH = {
  matchBackground: '#f6e7b4',
  matchOverviewRuler: '#d9b85a',
  activeMatchBackground: '#f0c75a',
  activeMatchColorOverviewRuler: '#b8860b',
};

/** The theme in use, from the main process (Settings > Appearance). Open terminals switch with it. */
let currentTheme: ThemeName = 'graphite';
const theme = (): ITheme => THEMES[currentTheme];
const searchColors = () => (isDarkTheme(currentTheme) ? DARK_SEARCH : LIGHT_SEARCH);
/**
 * Programs print "white" text expecting a dark background; on a light theme
 * xterm darkens any colour too faint to read. The dark themes are left exact.
 */
const minimumContrast = (): number => (isDarkTheme(currentTheme) ? 1 : 4.5);

type Listener = () => void;

/** The main process opens http(s) links in the default browser and blocks the rest. */
function openLink(url: string): void {
  window.open(url);
}

const CMD_EDIT_KEYS: Record<string, string> = {
  ArrowLeft: '\x01',
  ArrowRight: '\x05',
  Backspace: '\x15',
  Delete: '\x0b',
};

class TerminalHandle {
  readonly term: Terminal;
  readonly el: HTMLDivElement;
  private fit = new FitAddon();
  private search = new SearchAddon({ highlightLimit: 2000 });
  private opened = false;
  private attached = false;
  private disposed = false;
  private replaying = false;
  private exited: number | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private fitFrame = 0;
  title: string | undefined;

  constructor(
    readonly tabId: string,
    private onTitle: Listener,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'terminal-surface';
    this.term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      // Taller lines break up box drawing (Claude Code's borders) in the DOM renderer.
      lineHeight: 1.2,
      scrollback: 10_000,
      theme: theme(),
      minimumContrastRatio: minimumContrast(),
      macOptionIsMeta: optionAsMeta,
      macOptionClickForcesSelection: true,
      allowProposedApi: true,
      cursorBlink: true,
      // OSC 8 links (labeled links printed by programs like Claude Code). xterm's
      // default opens a blank window first, which the app blocks, so open the URL directly.
      linkHandler: { activate: (_e, uri) => openLink(uri) },
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(this.search);
    this.term.loadAddon(new WebLinksAddon((_e, url) => openLink(url)));
    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e));
    this.term.onData((data) => this.input(data));
    // Mouse reports in xterm's default (X10) encoding come here: bytes, not text.
    this.term.onBinary((data) => {
      if (!this.replaying && this.exited === undefined && this.attached) api.ptyWriteBinary(this.tabId, data);
    });
    this.term.onTitleChange((title) => {
      this.title = title;
      this.onTitle();
    });
  }

  private handleKey(e: KeyboardEvent): boolean {
    if (e.metaKey) {
      // Mac line editing, as other terminals do it: ⌘←/→ to the start or end
      // of the line, ⌘⌫ deletes to its start, ⌘⌦ to its end (Ctrl-A/E/U/K).
      const seq = !e.ctrlKey && !e.altKey && !e.shiftKey ? CMD_EDIT_KEYS[e.key] : undefined;
      if (seq && e.type === 'keydown') this.input(seq);
      // Every other ⌘ key belongs to the app menu, not the shell.
      return false;
    }
    // Shift+Enter inserts a newline in Claude Code (sent as Esc+Return, like Option+Return).
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
      if (e.type === 'keydown') this.input('\x1b\r');
      return false;
    }
    return true;
  }

  private input(data: string): void {
    // While old output is redrawn, xterm answers any terminal queries in it
    // (cursor position, colours); those answers must not be typed into the shell.
    if (this.replaying) return;
    if (this.exited !== undefined) {
      if (data === '\r') void this.restart();
      return;
    }
    if (this.attached) api.ptyWrite(this.tabId, data);
  }

  /** Puts the terminal on screen inside `host`. Starts the shell the first time. */
  show(host: HTMLElement): void {
    if (this.el.parentElement !== host) host.appendChild(this.el);
    if (!this.opened) {
      this.term.open(this.el);
      this.opened = true;
    }
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
    this.resizeObserver.observe(host);
    this.fitNow();
    if (!this.attached) void this.attach();
    this.term.refresh(0, this.term.rows - 1);
  }

  hide(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.el.remove();
  }

  focus(): void {
    this.term.focus();
  }

  isShown(): boolean {
    return this.el.isConnected;
  }

  /** Finds `query` in the scrollback, highlighting every match. False if there is none. */
  find(query: string, direction: 'next' | 'previous', incremental = false): boolean {
    if (!query) {
      this.search.clearDecorations();
      return false;
    }
    const opts: ISearchOptions = { incremental, decorations: searchColors() };
    return direction === 'next' ? this.search.findNext(query, opts) : this.search.findPrevious(query, opts);
  }

  clearFind(): void {
    this.search.clearDecorations();
    this.term.clearSelection();
  }

  /** Match counts as you search: index is -1 when the active match isn't known. */
  onFindResults(cb: (index: number, count: number) => void): () => void {
    const sub = this.search.onDidChangeResults((r) => cb(r.resultIndex, r.resultCount));
    return () => sub.dispose();
  }

  write(data: string): void {
    this.term.write(data, () => api.ptyAck(this.tabId, data.length));
  }

  /** The shell ended. A clean exit (typing `exit`) closes the tab, like most terminals. */
  ended(exit: PtyExitInfo): void {
    if (exit.clean) {
      void api.closeTab(this.tabId);
      return;
    }
    this.exited = exit.code;
    this.term.write(`\r\n\x1b[2m[Process exited with code ${exit.code}. Press Return to start a new shell.]\x1b[0m\r\n`);
  }

  dispose(): void {
    this.disposed = true;
    this.hide();
    this.term.dispose();
  }

  /** Types text into the terminal as a paste (bracketed, so the shell or Claude takes it literally). */
  paste(text: string): void {
    this.term.paste(text);
  }

  private async attach(restart = false): Promise<void> {
    this.attached = true;
    try {
      const { replay, exited } = await api.ptyAttach(this.tabId, this.term.cols, this.term.rows, restart);
      if (this.disposed) return; // the tab closed while it was attaching
      if (replay) {
        this.replaying = true;
        this.term.write(replay, () => (this.replaying = false));
      }
      if (exited) this.ended(exited);
    } catch (err) {
      // Let Return try again, the same way as after the shell exits.
      this.attached = false;
      this.exited = -1;
      const msg = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': /, '') : String(err);
      this.term.write(`\r\n\x1b[31m[Could not start a shell: ${msg}. Press Return to try again.]\x1b[0m\r\n`);
    }
  }

  private async restart(): Promise<void> {
    this.exited = undefined;
    this.term.reset();
    await this.attach(true);
  }

  private scheduleFit(): void {
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame = requestAnimationFrame(() => this.fitNow());
  }

  private fitNow(): void {
    if (!this.el.isConnected || this.el.clientWidth === 0) return;
    const { cols, rows } = this.term;
    this.fit.fit();
    if ((cols !== this.term.cols || rows !== this.term.rows) && this.attached) {
      api.ptyResize(this.tabId, this.term.cols, this.term.rows);
    }
  }

  /** Plain text of the buffer, for the smoke test. */
  text(): string {
    const buf = this.term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '');
    return lines.join('\n');
  }
}

class TerminalRegistry {
  private handles = new Map<string, TerminalHandle>();

  forEach(fn: (h: TerminalHandle) => void): void {
    this.handles.forEach(fn);
  }
  private listeners = new Set<Listener>();
  private version = 0;

  constructor() {
    api.onPtyData((tabId, data) => this.handles.get(tabId)?.write(data));
    api.onPtyExit((tabId, exit) => {
      // A tab with no terminal yet learns about the exit when it attaches.
      this.handles.get(tabId)?.ended(exit);
    });
    api.onTerminalEdit((cmd) => {
      // A text field or dialog with focus gets the page's own Copy / Select
      // All. Otherwise they act on the terminal on screen, even if you clicked
      // the sidebar after selecting text in it.
      const active = document.activeElement;
      const terminalFocused = !!this.focused();
      const inField = !terminalFocused && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);
      // Text selected on the page itself (e.g. the task description) is newer than a terminal's leftover selection.
      const sel = window.getSelection();
      const pageSelection = !terminalFocused && !!sel && !sel.isCollapsed && !sel.anchorNode?.parentElement?.closest('.terminal-surface');
      const h = this.focused() ?? this.onScreen();
      if (inField || pageSelection || !h || document.querySelector('.modal')) return api.pageEdit(cmd);
      if (cmd === 'copy') {
        const sel = h.term.getSelection();
        if (sel) api.writeClipboard(sel);
        else api.pageEdit(cmd);
      } else {
        h.term.selectAll();
      }
    });
  }

  get(tabId: string): TerminalHandle {
    let h = this.handles.get(tabId);
    if (!h) {
      h = new TerminalHandle(tabId, () => this.changed());
      this.handles.set(tabId, h);
    }
    return h;
  }

  peek(tabId: string): TerminalHandle | undefined {
    return this.handles.get(tabId);
  }

  /** Disposes terminals whose tabs no longer exist. */
  prune(liveTabIds: Set<string>): void {
    for (const [id, h] of this.handles) {
      if (!liveTabIds.has(id)) {
        h.dispose();
        this.handles.delete(id);
      }
    }
  }

  private onScreen(): TerminalHandle | undefined {
    for (const h of this.handles.values()) if (h.isShown()) return h;
    return undefined;
  }

  private focused(): TerminalHandle | undefined {
    for (const h of this.handles.values()) {
      if (h.term.textarea && h.term.textarea === document.activeElement) return h;
    }
    return undefined;
  }

  // Lets React re-render when a terminal's title changes.
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

/** From Settings: whether Option sends Meta. Applies to existing and new terminals. */
let optionAsMeta = true;

export function setOptionAsMeta(on: boolean): void {
  optionAsMeta = on;
  terminals.forEach((h) => (h.term.options.macOptionIsMeta = on));
}

export const terminals = new TerminalRegistry();

/** Puts a theme on every open terminal, and on ones created later. */
export function setTerminalTheme(name: ThemeName): void {
  if (name === currentTheme) return;
  currentTheme = name;
  terminals.forEach((h) => {
    h.term.options.theme = theme();
    h.term.options.minimumContrastRatio = minimumContrast();
  });
}

declare global {
  interface Window {
    __humanloopDebug?: {
      terminalText(tabId: string): string | undefined;
      command?(id: import('../../shared/commands').CommandId): void;
      showSettings?(): void;
    };
  }
}
window.__humanloopDebug = { terminalText: (tabId) => terminals.peek(tabId)?.text() };
