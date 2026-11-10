// Packaged-app smoke test, run when HUMANLOOP_SMOKE=1. It checks that the
// renderer loads, that node-pty can start zsh from inside the app bundle, and
// that a tab's output reaches the terminal on screen. Exits 0 on success.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { HOOK_COMMAND } from '../shared/hooks';

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

    // The shell integration wraps claude so it gets Humanloop's hooks.
    d.writeToTab(tabId, 'whence -w claude | tr a-z A-Z\r');
    await waitFor('the claude wrapper', () => output.includes('CLAUDE: FUNCTION'));
    log('claude is wrapped with the hooks');

    // Run the hook command the way Claude would: as a grandchild of
    // the tab's shell, so its $PPID's parent is the shell.
    const script = join(app.getPath('userData'), 'smoke-hook.sh');
    const event = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'smoke', source: 'startup' });
    // The sleep keeps the "claude" stand-in alive while the app looks up its parent, like a real session.
    writeFileSync(script, `printf '%s' '${event}' | sh -c '${HOOK_COMMAND}'\nsleep 5\n`);
    d.writeToTab(tabId, `sh '${script}'\r`);
    await waitFor('the hook event to reach the tab', () => js(`!!document.querySelector('.tab .glyph.idle')`));
    log('hook event received and shown');

    // Shortcut recorder: a key press while recording becomes the shortcut,
    // through the same before-input-event path a real key press takes.
    await js(`window.__humanloopDebug.showSettings()`);
    const keyButton = `[...document.querySelectorAll('.shortcut-row')].find((r) => r.querySelector('.shortcut-name').textContent === 'Next task').querySelector('.keys')`;
    await waitFor('the settings screen', () => js(`!!document.querySelector('.settings')`));
    await js(`${keyButton}.click()`);
    await waitFor('recording to start', () => js(`${keyButton}.textContent === 'Press keys'`));
    d.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers: ['meta'] });
    d.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers: ['meta'] });
    await waitFor('the recorded shortcut', () => js(`${keyButton}.textContent === '⌘J'`));
    log('shortcut recorded');

    // A clash: recording Find's shortcut for Clear terminal asks before taking it.
    const row = (name: string) => `[...document.querySelectorAll('.shortcut-row')].find((r) => r.querySelector('.shortcut-name').textContent === '${name}')`;
    await js(`${row('Clear terminal')}.querySelector('.keys').click()`);
    await waitFor('recording to start again', () => js(`${row('Clear terminal')}.querySelector('.keys').textContent === 'Press keys'`));
    d.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['meta'] });
    d.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['meta'] });
    await waitFor('the conflict line', () => js(`document.querySelector('.shortcut-notice')?.textContent.startsWith('Used by Find.')`));
    await js(`document.querySelector('.shortcut-notice .link').click()`);
    await waitFor('the shortcut to move', () => js(`${row('Find')}.querySelector('.keys').textContent === 'None' && ${row('Clear terminal')}.querySelector('.keys').textContent === '⌘F'`));
    log('conflicting shortcut reassigned');

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
