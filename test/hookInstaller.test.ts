import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The installer reads Claude's settings.json; point HOME at a throwaway folder,
// and drop CLAUDE_CONFIG_DIR, which it would use instead (and which may be real).
let home: string;
async function installer() {
  vi.resetModules();
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  return import('../src/main/hookInstaller');
}
const settings = () => join(home, '.claude', 'settings.json');

describe('applyChange', () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'humanloop-home-'));
    mkdirSync(join(home, '.claude'));
  });

  it('keeps file permissions and leaves a backup', async () => {
    writeFileSync(settings(), '{"model":"opus"}', { mode: 0o600 });
    const { applyChange } = await installer();
    const backup = applyChange((s) => ({ ...s, added: true }));
    expect(JSON.parse(readFileSync(settings(), 'utf8'))).toEqual({ model: 'opus', added: true });
    expect(statSync(settings()).mode & 0o777).toBe(0o600);
    expect(readFileSync(backup!, 'utf8')).toBe('{"model":"opus"}');
  });

  it('writes through a symlink, even a dangling one, instead of replacing it', async () => {
    mkdirSync(join(home, 'dotfiles'));
    symlinkSync(join(home, 'dotfiles', 'claude.json'), settings());
    const { applyChange } = await installer();
    expect(applyChange((s) => ({ ...s, a: 1 }))).toBeUndefined(); // nothing to back up yet
    expect(lstatSync(settings()).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'dotfiles', 'claude.json'), 'utf8'))).toEqual({ a: 1 });
    expect(statSync(join(home, 'dotfiles', 'claude.json')).mode & 0o777).toBe(0o600);
    // A second change goes through the link too, with the backup beside the real file.
    applyChange((s) => ({ ...s, b: 2 }));
    expect(lstatSync(settings()).isSymbolicLink()).toBe(true);
    expect(readdirSync(join(home, 'dotfiles')).some((f) => f.startsWith('claude.json.humanloop-backup-'))).toBe(true);
  });

  it('refuses to write over a file that is not valid JSON', async () => {
    writeFileSync(settings(), '{ not json');
    const { applyChange } = await installer();
    expect(() => applyChange((s) => s)).toThrow(/could not be read/);
    expect(readFileSync(settings(), 'utf8')).toBe('{ not json');
  });
});
