import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOOK_COMMAND, HOOK_EVENTS, hookSettings } from '../src/shared/hooks';

// The checker reads Claude's settings.json; point HOME at a throwaway folder,
// and drop CLAUDE_CONFIG_DIR, which it would use instead (and which may be real).
let home: string;
async function checker() {
  vi.resetModules();
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  return import('../src/main/claudeSettings');
}
const settings = () => join(home, '.claude', 'settings.json');

describe("Claude Code's settings", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'humanloop-home-'));
    mkdirSync(join(home, '.claude'));
  });

  it('are fine when missing or ordinary', async () => {
    expect((await checker()).currentHookState()).toBe('ok');
    writeFileSync(settings(), '{"model":"opus"}');
    expect((await checker()).currentHookState()).toBe('ok');
  });

  it('can turn hooks off, or be unreadable', async () => {
    writeFileSync(settings(), '{"disableAllHooks":true}');
    expect((await checker()).currentHookState()).toBe('disabled');
    writeFileSync(settings(), '{ not json');
    expect((await checker()).currentHookState()).toBe('unreadable');
  });
});

describe('hook settings passed to claude', () => {
  it('have one entry per event, all running the hook command', () => {
    const hooks = JSON.parse(hookSettings()).hooks as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 2 }] }]);
  });
});
