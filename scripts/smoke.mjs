// Launches the app in smoke-test mode and reports pass/fail.
//   node scripts/smoke.mjs            -> tests the packaged app in dist/
//   node scripts/smoke.mjs --dev      -> tests the unpackaged build in out/
// Set SMOKE_SCREENSHOT=/path/to.png to save a screenshot of the window.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dev = process.argv.includes('--dev');
let cmd;
let args = [];
if (dev) {
  cmd = createRequire(import.meta.url)('electron');
  args = [root];
} else {
  const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
  cmd = join(root, 'dist', arch, 'Humanloop.app', 'Contents', 'MacOS', 'Humanloop');
  if (!existsSync(cmd)) {
    console.error(`No packaged app at ${cmd}. Run "npm run package" first.`);
    process.exit(1);
  }
}

const userData = mkdtempSync(join(tmpdir(), 'humanloop-smoke-'));
const env = { ...process.env, HUMANLOOP_SMOKE: '1', HUMANLOOP_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
if (process.env.SMOKE_SCREENSHOT) env.HUMANLOOP_SMOKE_SCREENSHOT = process.env.SMOKE_SCREENSHOT;

console.log(`Running ${cmd}`);
const child = spawn(cmd, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
const killer = setTimeout(() => {
  console.error('[smoke] FAIL: app did not exit within 60s');
  child.kill('SIGKILL');
}, 60_000);
child.on('exit', (code) => {
  clearTimeout(killer);
  rmSync(userData, { recursive: true, force: true });
  console.log(code === 0 ? 'Smoke test passed.' : `Smoke test failed (exit ${code}).`);
  process.exit(code ?? 1);
});
