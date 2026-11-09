// Fix-ups after npm install.

import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const modules = join(import.meta.dirname, '..', 'node_modules');

// node-pty's prebuilt spawn-helper is published without its execute bit, which
// makes every spawn fail with "posix_spawnp failed". Restore it.
const prebuilds = join(modules, 'node-pty', 'prebuilds');
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}

// Electron 45 fetches its binary the first time its own launcher runs, not at
// install, and electron-vite (npm run dev) doesn't use that launcher: on a fresh
// checkout it fails with "Electron uninstall". Fetch it now with Electron's
// installer (checked against the checksums in the package; nothing happens if
// it's already there). Packaging bundles this same copy (electronDist), so it
// needs no network either.
const electronInstaller = join(modules, 'electron', 'install.js');
if (existsSync(electronInstaller)) {
  const r = spawnSync(process.execPath, [electronInstaller], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// In development the menu bar shows the bundle name of node_modules' stock
// Electron.app ("Electron"), which the app can't change while running. Name
// it after the dev build instead. (That copy is only ad-hoc signed, so its
// Info.plist can be edited; the packaged app has its own name.)
if (process.platform === 'darwin') {
  const plist = join(modules, 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist');
  if (existsSync(plist)) {
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      spawnSync('plutil', ['-replace', key, '-string', 'Humanloop Dev', plist]);
    }
  }
}
