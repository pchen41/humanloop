import { describe, expect, it } from 'vitest';
import { applyHookEvent, applyInterrupt, taskAgentState, type HookEvent, type TabAgent } from '../src/shared/agents';
import { HOOK_COMMAND, HOOK_EVENTS, hookStatus, installHooks, removeHooks } from '../src/shared/hooks';
import { DEFAULT_POLICY } from '../src/shared/model';

const S = 'session-1';
function run(events: HookEvent[], start?: TabAgent): TabAgent | undefined {
  return events.reduce<TabAgent | undefined>((a, e) => applyHookEvent(a, { session_id: S, ...e }), start);
}
const ev = (hook_event_name: string, extra: HookEvent = {}): HookEvent => ({ hook_event_name, ...extra });

describe('applyHookEvent', () => {
  it('follows a normal turn: start, prompt, tools, stop', () => {
    expect(run([ev('SessionStart', { source: 'startup' })])?.state).toBe('idle');
    expect(run([ev('SessionStart'), ev('UserPromptSubmit')])?.state).toBe('working');
    expect(run([ev('SessionStart'), ev('UserPromptSubmit'), ev('PreToolUse')])?.state).toBe('working');
    expect(run([ev('SessionStart'), ev('UserPromptSubmit'), ev('Stop')])?.state).toBe('idle');
  });

  it('needs you on a permission request until the tool runs', () => {
    const asked = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('PreToolUse'), ev('PermissionRequest')]);
    expect(asked?.state).toBe('needsYou');
    // Approving: the tool's PostToolUse (or the next PreToolUse) means working again.
    expect(run([ev('PostToolUse')], asked)?.state).toBe('working');
  });

  it('keeps needs you when idle_prompt arrives, and goes idle otherwise', () => {
    const asked = run([ev('SessionStart'), ev('PermissionRequest')]);
    expect(run([ev('Notification', { notification_type: 'idle_prompt' })], asked)?.state).toBe('needsYou');
    const working = run([ev('SessionStart'), ev('UserPromptSubmit')]); // e.g. interrupted with Esc
    expect(run([ev('Notification', { notification_type: 'idle_prompt' })], working)?.state).toBe('idle');
    // Sandbox network prompts send only this notification, never PermissionRequest.
    expect(run([ev('Notification', { notification_type: 'permission_prompt' })], working)?.state).toBe('needsYou');
  });

  it('treats API errors and MCP prompts as needing you', () => {
    expect(run([ev('SessionStart'), ev('UserPromptSubmit'), ev('StopFailure')])?.state).toBe('needsYou');
    const elicit = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('Elicitation')]);
    expect(elicit?.state).toBe('needsYou');
    expect(run([ev('ElicitationResult')], elicit)?.state).toBe('working');
  });

  it('ignores subagent activity except permission requests', () => {
    const idle = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('Stop')]);
    expect(run([ev('PreToolUse', { agent_id: 'a1' })], idle)?.state).toBe('idle');
    expect(run([ev('PermissionRequest', { agent_id: 'a1' })], idle)?.state).toBe('needsYou');
  });

  it('records background tasks from Stop and SubagentStop', () => {
    const bg = [{ id: 'b1', type: 'shell', status: 'running', command: 'npm test' }];
    const a = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('Stop', { background_tasks: bg })]);
    expect(a?.backgroundTasks).toEqual([{ id: 'b1', type: 'shell', status: 'running' }]);
    expect(run([ev('SubagentStop', { agent_id: 'x', background_tasks: [] })], a)?.backgroundTasks).toEqual([]);
  });

  it('ignores events from other sessions once a session is known', () => {
    const a = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('Stop')]);
    expect(applyHookEvent(a, { session_id: 'other', hook_event_name: 'PreToolUse' })).toBe(a);
    // A prompt you typed proves the tab moved on, even if its SessionStart was missed.
    expect(applyHookEvent(a, { session_id: 'other', hook_event_name: 'UserPromptSubmit' })).toMatchObject({
      sessionId: 'other',
      state: 'working',
    });
    // A new SessionStart (e.g. /clear or /resume) switches sessions.
    expect(applyHookEvent(a, { session_id: 'other', hook_event_name: 'SessionStart', source: 'clear' })?.sessionId).toBe('other');
  });

  it('adopts a session it never saw start', () => {
    expect(run([ev('UserPromptSubmit')])).toMatchObject({ sessionId: S, state: 'working' });
  });

  it('keeps state through compaction and clears it on SessionEnd', () => {
    const working = run([ev('SessionStart'), ev('UserPromptSubmit')]);
    expect(run([ev('SessionStart', { source: 'compact' })], working)?.state).toBe('working');
    expect(run([ev('SessionEnd')], working)).toBeUndefined();
  });
});

describe('open prompts per agent', () => {
  it("clears a subagent's prompt when that subagent's tool runs", () => {
    const asked = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('PermissionRequest', { agent_id: 'sub' })]);
    expect(asked?.state).toBe('needsYou');
    expect(run([ev('PostToolUse', { agent_id: 'sub' })], asked)?.state).toBe('working');
  });

  it("keeps a subagent's prompt open when the main agent's tool finishes", () => {
    const asked = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('PermissionRequest', { agent_id: 'sub' })]);
    expect(run([ev('PostToolUse')], asked)?.state).toBe('needsYou');
    expect(run([ev('PostToolUse'), ev('SubagentStop', { agent_id: 'sub' })], asked)?.state).toBe('working');
  });

  it('keeps needs you after a denied prompt until your next prompt', () => {
    const asked = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('PreToolUse'), ev('PermissionRequest')]);
    // Denying fires nothing, so the state holds; a new prompt clears it.
    expect(run([ev('UserPromptSubmit')], asked)?.state).toBe('working');
  });

  it('treats an API error as needs you until the next prompt', () => {
    const failed = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('StopFailure')]);
    expect(failed?.state).toBe('needsYou');
    expect(run([ev('UserPromptSubmit')], failed)?.state).toBe('working');
  });
});

describe('applyInterrupt (Esc)', () => {
  it('ignores tool events from the interrupted turn until the next prompt', () => {
    const stopped = applyInterrupt(run([ev('SessionStart'), ev('UserPromptSubmit'), ev('PreToolUse')]));
    expect(stopped?.state).toBe('idle');
    expect(run([ev('PostToolUse')], stopped)?.state).toBe('idle');
    expect(run([ev('UserPromptSubmit'), ev('PreToolUse')], stopped)?.state).toBe('working');
  });

  it('marks a working agent idle and leaves other states alone', () => {
    const working = run([ev('SessionStart'), ev('UserPromptSubmit')]);
    expect(applyInterrupt(working)?.state).toBe('idle');
    const asked = run([ev('SessionStart'), ev('PermissionRequest')]);
    expect(applyInterrupt(asked)).toBe(asked);
    expect(applyInterrupt(undefined)).toBeUndefined();
  });
});

describe('taskAgentState', () => {
  const agent = (state: TabAgent['state'], bg: TabAgent['backgroundTasks'] = []): TabAgent => ({
    sessionId: 's',
    state,
    turn: state === 'needsYou' ? 'error' : state,
    waitingOn: [],
    started: [],
    interrupted: false,
    backgroundTasks: bg,
  });

  it('is none without Claude tabs and needs you if any tab does', () => {
    expect(taskAgentState([undefined], DEFAULT_POLICY)).toBe('none');
    expect(taskAgentState([agent('working'), agent('needsYou')], DEFAULT_POLICY)).toBe('needsYou');
  });

  it('applies Any and All', () => {
    const tabs = [agent('working'), agent('idle')];
    expect(taskAgentState(tabs, { ...DEFAULT_POLICY, multiAgent: 'any' })).toBe('idle');
    expect(taskAgentState(tabs, { ...DEFAULT_POLICY, multiAgent: 'all' })).toBe('working');
  });

  it('counts background work per the policy', () => {
    const sub = [agent('idle', [{ id: '1', type: 'subagent', status: 'running' }])];
    const shell = [agent('idle', [{ id: '1', type: 'shell', status: 'running' }])];
    expect(taskAgentState(sub, DEFAULT_POLICY)).toBe('working'); // subagents count by default
    expect(taskAgentState(shell, DEFAULT_POLICY)).toBe('idle'); // background shells don't
    expect(taskAgentState(shell, { ...DEFAULT_POLICY, backgroundShellsBusy: true })).toBe('working');
  });
});

describe('hook installer', () => {
  const userHook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };

  it('adds one entry per event after the user hooks and keeps other settings', () => {
    const out = installHooks({ model: 'opus', hooks: { PreToolUse: [userHook] } });
    expect(out.model).toBe('opus');
    const hooks = out.hooks as Record<string, unknown[]>;
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(hooks.PreToolUse).toEqual([userHook, { hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 2 }] }]);
    expect(hookStatus(out)).toBe('installed');
  });

  it('is idempotent and replaces outdated entries', () => {
    const old = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'curl --unix-socket "$HUMANLOOP_SOCK" http://humanloop/hook' }] }] } };
    expect(hookStatus(old)).toBe('outdated');
    const once = installHooks(old);
    expect(installHooks(once)).toEqual(once);
    expect((once.hooks as Record<string, unknown[]>).Stop).toHaveLength(1);
  });

  it("keeps a user's own hook that merely checks HUMANLOOP_SOCK", () => {
    const mine = { hooks: [{ type: 'command', command: '[ -n "$HUMANLOOP_SOCK" ] && my-notifier' }] };
    expect(removeHooks(installHooks({ hooks: { Notification: [mine] } }))).toEqual({ hooks: { Notification: [mine] } });
  });

  it('removes only its own entries', () => {
    const out = removeHooks(installHooks({ theme: 'dark', hooks: { PreToolUse: [userHook] } }));
    expect(out).toEqual({ theme: 'dark', hooks: { PreToolUse: [userHook] } });
    expect(removeHooks(installHooks({}))).toEqual({});
    expect(hookStatus({})).toBe('missing');
  });
});

describe('review fixes: prompts per tool call', () => {
  const perm = (tool: string, input: unknown, extra: HookEvent = {}) => ev('PermissionRequest', { tool_name: tool, tool_input: input, ...extra });
  const post = (tool: string, input: unknown, extra: HookEvent = {}) => ev('PostToolUse', { tool_name: tool, tool_input: input, ...extra });

  it('keeps needs you while a second parallel prompt is still open', () => {
    const two = run([ev('SessionStart'), ev('UserPromptSubmit'), perm('WebFetch', { url: 'a' }), perm('WebFetch', { url: 'b' })]);
    const one = run([post('WebFetch', { url: 'a' })], two);
    expect(one?.state).toBe('needsYou');
    expect(run([post('WebFetch', { url: 'b' })], one)?.state).toBe('working');
  });

  it("doesn't let another tool finishing answer a prompt", () => {
    const asked = run([ev('SessionStart'), ev('UserPromptSubmit'), perm('Bash', { command: 'rm x' })]);
    expect(run([post('Read', { file: 'y' })], asked)?.state).toBe('needsYou');
    expect(run([ev('PreToolUse', { tool_name: 'Read' })], asked)?.state).toBe('needsYou');
  });

  it('answers a prompt whose input was changed on approval', () => {
    const asked = run([ev('SessionStart'), ev('UserPromptSubmit'), perm('Bash', { command: 'npm test' })]);
    expect(run([post('Bash', { command: 'npm test -- --watch=false' })], asked)?.state).toBe('working');
  });

  it("attributes a subagent's question to the subagent", () => {
    const asked = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('Elicitation', { agent_id: 'sub' })]);
    // The main agent stopping doesn't close the subagent's question...
    expect(run([ev('Stop')], asked)?.state).toBe('needsYou');
    // ...but the subagent's own result or stop does.
    expect(run([ev('ElicitationResult', { agent_id: 'sub' })], asked)?.state).toBe('working');
    expect(run([ev('Stop'), ev('SubagentStop', { agent_id: 'sub' })], asked)?.state).toBe('idle');
  });

  it("clears a subagent's prompt left open by an interrupt on your next prompt", () => {
    const asked = applyInterrupt(run([ev('SessionStart'), ev('UserPromptSubmit'), perm('Bash', {}, { agent_id: 'sub' })]));
    const next = run([ev('UserPromptSubmit'), ev('Stop')], asked);
    expect(next?.state).toBe('idle');
    expect(next?.waitingOn).toEqual([]);
  });

  it('ignores a tool event that arrives after Esc, until your next prompt', () => {
    const stopped = applyInterrupt(run([ev('SessionStart'), ev('UserPromptSubmit')]));
    // The PreToolUse hook was already on its way when you pressed Esc: it must not mark Claude working again.
    expect(run([ev('PreToolUse', { tool_name: 'Read' })], stopped)?.state).toBe('idle');
    expect(run([post('Read', {})], stopped)?.state).toBe('idle');
    expect(run([ev('UserPromptSubmit'), ev('PreToolUse', { tool_name: 'Read' })], stopped)?.state).toBe('working');
  });

  it('treats a tool cut short by an interrupt as the end of the turn', () => {
    const a = run([ev('SessionStart'), ev('UserPromptSubmit'), ev('PreToolUse', { tool_name: 'Bash' })]);
    expect(run([ev('PostToolUseFailure', { tool_name: 'Bash', is_interrupt: true })], a)?.state).toBe('idle');
  });

  it("doesn't let a different call of the same tool answer a prompt", () => {
    // Read A was auto-allowed; Read B is waiting for approval.
    const asked = run([
      ev('SessionStart'),
      ev('UserPromptSubmit'),
      ev('PreToolUse', { tool_name: 'Read', tool_input: { file: 'a' } }),
      ev('PreToolUse', { tool_name: 'Read', tool_input: { file: 'b' } }),
      perm('Read', { file: 'b' }),
    ]);
    expect(run([post('Read', { file: 'a' })], asked)?.state).toBe('needsYou');
    expect(run([post('Read', { file: 'a' }), post('Read', { file: 'b' })], asked)?.state).toBe('working');
  });

  it('keeps identical parallel prompts apart', () => {
    const two = run([ev('SessionStart'), ev('UserPromptSubmit'), perm('Bash', { command: 'ls' }), perm('Bash', { command: 'ls' })]);
    expect(run([post('Bash', { command: 'ls' })], two)?.state).toBe('needsYou');
    expect(run([post('Bash', { command: 'ls' }), post('Bash', { command: 'ls' })], two)?.state).toBe('working');
  });

  it('keeps questions from two MCP servers apart', () => {
    const two = run([
      ev('SessionStart'),
      ev('UserPromptSubmit'),
      ev('Elicitation', { mcp_server_name: 'github' }),
      ev('Elicitation', { mcp_server_name: 'linear' }),
      ev('Notification', { notification_type: 'elicitation_dialog' }),
    ]);
    const one = run([ev('ElicitationResult', { mcp_server_name: 'github' })], two);
    expect(one?.state).toBe('needsYou');
    expect(run([ev('ElicitationResult', { mcp_server_name: 'linear' })], one)?.state).toBe('working');
  });

  it("keeps the session's starting directory for resume", () => {
    const a = run([ev('SessionStart', { cwd: '/proj' }), ev('UserPromptSubmit', { cwd: '/proj/sub' }), ev('Stop', { cwd: '/proj/sub' })]);
    expect(a?.cwd).toBe('/proj');
  });
});
