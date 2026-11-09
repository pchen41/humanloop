// Fix-ups after npm install.
//
// node-pty's prebuilt spawn-helper is published without its execute bit, which
// makes every spawn fail with "posix_spawnp failed". Restore it after install.

import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const prebuilds = join(import.meta.dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}

// In development the menu bar shows the bundle name of node_modules' stock
// Electron.app ("Electron"), which the app can't change while running. Name
// it after the dev build instead. (That copy is only ad-hoc signed, so its
// Info.plist can be edited; the packaged app has its own name.)
if (process.platform === 'darwin') {
  const plist = join(import.meta.dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist');
  if (existsSync(plist)) {
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      spawnSync('plutil', ['-replace', key, '-string', 'Humanloop Dev', plist]);
    }
  }
}
