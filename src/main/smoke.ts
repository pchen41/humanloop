// Packaged-app smoke test, run when HUMANLOOP_SMOKE=1. It checks that the
// renderer loads, that node-pty can start zsh from inside the app bundle, and
// that a tab's output reaches the terminal on screen. Exits 0 on success.

import { writeFileSync } from 'node:fs';
import { app, type BrowserWindow } from 'electron';

interface SmokeDeps {
  win: BrowserWindow;
  createTaskAndTab(): { taskId: string; tabId: string };
  writeToTab(tabId: string, data: string): void;
  observeOutput(fn: (tabId: string, data: string) => void): void;
}

const TIMEOUT_MS = 20_000;

function log(msg: string): void {
  process.stdout.write(`[smoke] ${msg}\n`);
}

async function waitFor<T>(what: string, fn: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function runSmokeTest(d: SmokeDeps): Promise<void> {
  try {
    const js = (code: string) => d.win.webContents.executeJavaScript(code);
    await waitFor('the renderer', () => js(`!!document.querySelector('[data-testid="sidebar"]')`));
    log('renderer loaded');

    let output = '';
    let tabId = '';
    d.observeOutput((id, data) => {
      if (id === tabId) output += data;
    });
    ({ tabId } = d.createTaskAndTab());
    await waitFor('the terminal to attach', () => js(`!!document.querySelector('.xterm')`));
    await waitFor('a zsh prompt', () => output.length > 0);
    log('zsh started');

    // $((40+2)) means the marker only appears in the output, not in the echoed input.
    d.writeToTab(tabId, 'echo humanloop-smoke-$((40+2))\r');
    await waitFor('command output', () => output.includes('humanloop-smoke-42'));
    log('command output received');

    const shown = await waitFor('the output on screen', () =>
      js(`window.__humanloopDebug?.terminalText(${JSON.stringify(tabId)})?.includes('humanloop-smoke-42')`),
    );
    log(`output drawn in the terminal: ${shown}`);

    const shot = process.env.HUMANLOOP_SMOKE_SCREENSHOT;
    if (shot) {
      await new Promise((r) => setTimeout(r, 500));
      writeFileSync(shot, (await d.win.webContents.capturePage()).toPNG());
      log(`screenshot saved to ${shot}`);
    }
    log('PASS');
    app.exit(0);
  } catch (err) {
    log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    app.exit(1);
  }
}
