// node-pty's prebuilt spawn-helper is published without its execute bit, which
// makes every spawn fail with "posix_spawnp failed". Restore it after install.

import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const prebuilds = join(import.meta.dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}
