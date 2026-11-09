// Agent state from Claude Code hook events. Pure functions: the main process
// feeds events in, and the renderer and (later) the queue engine read results.

import type { Policy } from './model';

export type AgentState = 'working' | 'needsYou' | 'idle';

export interface BackgroundTask {
  id: string;
  /** e.g. shell, subagent, monitor, workflow, teammate, "cloud session", "MCP task" */
  type: string;
  status: string;
  description?: string;
}

/** The Claude session running in one tab. Runtime only, never saved. */
export interface TabAgent {
  sessionId: string;
  cwd?: string;
  state: AgentState;
  /** Work still in flight when Claude last stopped (from Stop / SubagentStop). */
  backgroundTasks: BackgroundTask[];
}

/** The parts of a hook event's JSON that Humanloop reads. */
export interface HookEvent {
  hook_event_name?: unknown;
  session_id?: unknown;
  cwd?: unknown;
  source?: unknown;
  notification_type?: unknown;
  agent_id?: unknown;
  background_tasks?: unknown;
}

function backgroundTasks(v: unknown): BackgroundTask[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((t) => {
    if (typeof t !== 'object' || t === null) return [];
    const o = t as Record<string, unknown>;
    if (typeof o.id !== 'string') return [];
    const task: BackgroundTask = {
      id: o.id,
      type: typeof o.type === 'string' ? o.type : 'unknown',
      status: typeof o.status === 'string' ? o.status : 'unknown',
    };
    if (typeof o.description === 'string') task.description = o.description.slice(0, 200);
    return [task];
  });
}

/**
 * Applies one hook event to a tab's agent. Returns undefined when the tab no
 * longer has a Claude session (SessionEnd).
 *
 * | Event                                         | State                                   |
 * |-----------------------------------------------|-----------------------------------------|
 * | SessionStart                                  | idle; new session (compact keeps state) |
 * | UserPromptSubmit, Pre/PostToolUse(Failure)     | working                                 |
 * | ElicitationResult                             | working                                 |
 * | PermissionRequest, Elicitation                | needs you (also from subagents)         |
 * | Notification idle_prompt                      | idle (needs you stays needs you)        |
 * | Notification elicitation_dialog               | needs you                               |
 * | Stop                                          | idle; records background tasks          |
 * | StopFailure                                   | needs you (API error)                   |
 * | SubagentStop                                  | records background tasks                |
 * | SessionEnd                                    | no agent                                |
 *
 * Other events with agent_id come from subagents and leave the state alone.
 */
export function applyHookEvent(prev: TabAgent | undefined, ev: HookEvent): TabAgent | undefined {
  const name = typeof ev.hook_event_name === 'string' ? ev.hook_event_name : '';
  const sessionId = typeof ev.session_id === 'string' ? ev.session_id : '';
  if (!name || !sessionId) return prev;
  const cwd = typeof ev.cwd === 'string' ? ev.cwd : prev?.cwd;

  if (name === 'SessionStart') {
    if (ev.source === 'compact' && prev?.sessionId === sessionId) return { ...prev, cwd };
    return { sessionId, cwd, state: 'idle', backgroundTasks: [] };
  }

  // Events from another session (an old one, or one we never saw start) are
  // adopted only when the tab has no session yet, e.g. hooks installed mid-session.
  let agent: TabAgent;
  if (!prev) agent = { sessionId, cwd, state: 'idle', backgroundTasks: [] };
  else if (prev.sessionId !== sessionId) return prev;
  else agent = { ...prev, cwd };

  const set = (state: AgentState): TabAgent => (agent.state === state ? agent : { ...agent, state });
  const fromSubagent = typeof ev.agent_id === 'string' && ev.agent_id !== '';

  switch (name) {
    case 'PermissionRequest':
    case 'Elicitation':
      return set('needsYou');
    case 'Notification':
      if (ev.notification_type === 'elicitation_dialog') return set('needsYou');
      if (ev.notification_type === 'idle_prompt' && agent.state !== 'needsYou') return set('idle');
      return agent;
    case 'SubagentStop':
      return { ...agent, backgroundTasks: backgroundTasks(ev.background_tasks) };
    case 'SessionEnd':
      return undefined;
  }
  if (fromSubagent) return agent;

  switch (name) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'ElicitationResult':
      return set('working');
    case 'Stop':
      return { ...agent, state: 'idle', backgroundTasks: backgroundTasks(ev.background_tasks) };
    case 'StopFailure':
      return set('needsYou');
    default:
      return agent;
  }
}

/**
 * You pressed Esc in the tab. Claude Code fires no hook when a turn is
 * interrupted (checked with every hook event registered, Claude Code 2.1.319),
 * so a working agent is marked idle here. Needs-you stays as is: an interrupted
 * permission prompt or question still leaves Claude waiting for you.
 */
export function applyInterrupt(agent: TabAgent | undefined): TabAgent | undefined {
  return agent?.state === 'working' ? { ...agent, state: 'idle' } : agent;
}

/** Background shells and monitors follow the shells setting; all other kinds follow the subagents setting. */
const SHELL_LIKE = new Set(['shell', 'monitor']);

/** A tab's state once background work is counted per the policy. */
export function effectiveTabState(agent: TabAgent, policy: Policy): AgentState {
  if (agent.state !== 'idle') return agent.state;
  const busy = agent.backgroundTasks.some((t) =>
    SHELL_LIKE.has(t.type) ? policy.backgroundShellsBusy : policy.subagentsBusy,
  );
  return busy ? 'working' : 'idle';
}

export type TaskAgentState = AgentState | 'none';

/**
 * A task's state from its tabs' agents:
 * any tab needs you -> needs you; otherwise Any/All decides idle; no Claude tabs -> none.
 */
export function taskAgentState(agents: (TabAgent | undefined)[], policy: Policy): TaskAgentState {
  const states = agents.filter((a): a is TabAgent => !!a).map((a) => effectiveTabState(a, policy));
  if (!states.length) return 'none';
  if (states.includes('needsYou')) return 'needsYou';
  const idle = policy.multiAgent === 'all' ? states.every((s) => s === 'idle') : states.includes('idle');
  return idle ? 'idle' : 'working';
}
