import { describe, expect, it } from 'vitest';
import { HOOK_COMMAND, HOOK_EVENTS, hookSettings } from '../src/shared/hooks';

describe('hook settings passed to claude', () => {
  it('have one entry per event, all running the hook command', () => {
    const hooks = JSON.parse(hookSettings()).hooks as Record<string, unknown>;
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 2 }] }]);
  });
});
