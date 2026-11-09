// PtyManager against real zsh processes (node-pty), for the lifecycle cases
// that unit tests of the pure code can't reach.

import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyManager, type PtyExit } from '../src/main/pty';

const env = { PATH: '/usr/bin:/bin', HOME: process.env.HOME!, TERM: 'xterm-256color' };
const opts = { cols: 80, rows: 24, cwd: '/tmp', env };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!what()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await wait(50);
  }
}

let ptys: PtyManager;
const exits: Record<string, PtyExit> = {};
let output = '';
function start() {
  ptys = new PtyManager({
    data: (_tab, data) => (output += data),
    exit: (tab, exit) => (exits[tab] = exit),
  });
}
afterEach(() => ptys?.killAll());

describe('PtyManager', () => {
  it('tells a running program from the shell at its prompt, even a script named like a shell', async () => {
    start();
    ptys.attach('t', opts);
    await until(() => output.includes('%') || output.includes('$'));
    await wait(300);
    expect(ptys.busyProgram('t')).toBeUndefined();
    ptys.write('t', "/bin/bash -c 'sleep 2; true'\r");
    await wait(500);
    expect(ptys.busyProgram('t')).toBeTruthy();
  }, 10000);

  it('keeps the output and exit of a shell that ends while nothing shows it', async () => {
    start();
    ptys.attach('t', opts);
    await wait(800);
    ptys.write('t', 'sleep 0.5; echo last-words; exit 3\r');
    ptys.detachAll(); // the window closes
    await until(() => exits.t !== undefined);
    const back = ptys.attach('t', opts); // the window reopens
    expect(back.exited).toEqual({ code: 3, clean: false });
    expect(back.replay).toContain('last-words');
    expect(ptys.attach('t', opts, true).exited).toBeUndefined(); // Return restarts it
  }, 10000);

  it('on quit, also stops programs that ignore SIGHUP', async () => {
    start();
    ptys.attach('t', opts);
    await wait(800);
    ptys.write('t', "perl -e '$SIG{HUP}=\"IGNORE\"; $0=\"hl-hup-survivor\"; sleep 60' &\r");
    const survivors = () =>
      execFileSync('/bin/ps', ['-axo', 'pid=,command='])
        .toString()
        .split('\n')
        .filter((l) => /^\s*\d+ hl-hup-survivor/.test(l));
    await until(() => survivors().length === 1);
    await ptys.shutdown(1000);
    await wait(200);
    expect(survivors()).toEqual([]);
  }, 15000);
});
