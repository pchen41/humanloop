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

  const named = (name: string) => () =>
    execFileSync('/bin/ps', ['-axo', 'pid=,command='])
      .toString()
      .split('\n')
      .filter((l) => new RegExp(`^\\s*\\d+ ${name}`).test(l));
  const ignoringHup = (name: string) => `perl -e '$SIG{HUP}="IGNORE"; $0="${name}"; sleep 60'`;

  it('on quit, stops a foreground program that ignores SIGHUP', async () => {
    start();
    ptys.attach('t', opts);
    await wait(800);
    ptys.write('t', ignoringHup('hl-hup-foreground') + '\r');
    const found = named('hl-hup-foreground');
    await until(() => found().length === 1);
    await ptys.shutdown(1000);
    await wait(200);
    expect(found()).toEqual([]);
  }, 15000);

  it('leaves a nohup job running, as closing a Terminal window does', async () => {
    start();
    ptys.attach('t', opts);
    await wait(800);
    ptys.write('t', `nohup ${ignoringHup('hl-hup-nohup')} >/dev/null 2>&1 &\r`);
    const found = named('hl-hup-nohup');
    await until(() => found().length === 1);
    await ptys.shutdown(1000);
    await wait(200);
    try {
      expect(found()).toHaveLength(1);
    } finally {
      for (const l of found()) process.kill(Number(l.trim().split(/\s+/)[0]), 'SIGKILL');
    }
  }, 15000);

  it('treats a program that replaced the shell with exec as running', async () => {
    start();
    ptys.attach('t', opts);
    await wait(800);
    ptys.write('t', 'exec sleep 5\r');
    await wait(600);
    expect(ptys.busyProgram('t')).toBe('sleep');
  }, 10000);
});

describe('shellEnv', () => {
  it("removes a parent Claude session's markers but keeps Claude configuration", async () => {
    const { shellEnv } = await import('../src/main/pty');
    const saved = { ...process.env };
    Object.assign(process.env, {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CONFIG_DIR: '/x',
    });
    try {
      const env = shellEnv({});
      expect(env.CLAUDECODE).toBeUndefined();
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
      expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
      expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
      expect(env.CLAUDE_CONFIG_DIR).toBe('/x');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    }
  });
});
