// One xterm.js terminal per tab, kept alive while hidden so output keeps
// arriving and scrollback survives tab and task switches.
//
// Uses xterm's default DOM renderer. @xterm/addon-webgl 0.19 with xterm 6.0
// drew glyphs at half size on Retina screens, so it is left out for now.

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITheme } from '@xterm/xterm';

const api = window.humanloop;

const THEME: ITheme = {
  background: '#151517',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#151517',
  selectionBackground: '#3b4a6b',
  black: '#1e1e22',
  red: '#f2777a',
  green: '#99cc99',
  yellow: '#ffcc66',
  blue: '#6699cc',
  magenta: '#cc99cc',
  cyan: '#66cccc',
  white: '#d4d4d8',
  brightBlack: '#6b6b74',
  brightRed: '#ff8f91',
  brightGreen: '#b5e0b5',
  brightYellow: '#ffdd88',
  brightBlue: '#88b4e0',
  brightMagenta: '#e0b4e0',
  brightCyan: '#88e0e0',
  brightWhite: '#fafafa',
};

type Listener = () => void;

/** The main process opens http(s) links in the default browser and blocks the rest. */
function openLink(url: string): void {
  window.open(url);
}

class TerminalHandle {
  readonly term: Terminal;
  readonly el: HTMLDivElement;
  private fit = new FitAddon();
  private opened = false;
  private attached = false;
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
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 10_000,
      theme: THEME,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      allowProposedApi: true,
      cursorBlink: true,
      // OSC 8 links (labeled links printed by programs like Claude Code). xterm's
      // default opens a blank window first, which the app blocks, so open the URL directly.
      linkHandler: { activate: (_e, uri) => openLink(uri) },
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon((_e, url) => openLink(url)));
    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e));
    this.term.onData((data) => this.input(data));
    this.term.onTitleChange((title) => {
      this.title = title;
      this.onTitle();
    });
  }

  private handleKey(e: KeyboardEvent): boolean {
    // ⌘ shortcuts belong to the app menu, not the shell.
    if (e.metaKey) return false;
    // Shift+Enter inserts a newline in Claude Code (sent as Esc+Return, like Option+Return).
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
      if (e.type === 'keydown') this.input('\x1b\r');
      return false;
    }
    return true;
  }

  private input(data: string): void {
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
      const ta = this.term.textarea;
      ta?.addEventListener('focus', () => api.setTerminalFocused(true));
      ta?.addEventListener('blur', () => api.setTerminalFocused(false));
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

  write(data: string): void {
    this.term.write(data, () => api.ptyAck(this.tabId, data.length));
  }

  exit(code: number): void {
    this.exited = code;
    this.term.write(`\r\n\x1b[2m[Process exited with code ${code}. Press Return to start a new shell.]\x1b[0m\r\n`);
  }

  dispose(): void {
    this.hide();
    this.term.dispose();
  }

  private async attach(): Promise<void> {
    this.attached = true;
    try {
      const { replay } = await api.ptyAttach(this.tabId, this.term.cols, this.term.rows);
      if (replay) this.term.write(replay);
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
    await this.attach();
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
  private listeners = new Set<Listener>();
  private version = 0;

  constructor() {
    api.onPtyData((tabId, data) => this.handles.get(tabId)?.write(data));
    api.onPtyExit((tabId, code) => {
      const h = this.handles.get(tabId);
      if (!h) return;
      // A clean exit (typing `exit`) closes the tab, like most terminals.
      if (code === 0) void api.closeTab(tabId);
      else h.exit(code);
    });
    api.onTerminalEdit((cmd) => {
      const h = this.focused();
      if (!h) return;
      if (cmd === 'copy') {
        const sel = h.term.getSelection();
        if (sel) api.writeClipboard(sel);
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

export const terminals = new TerminalRegistry();

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
