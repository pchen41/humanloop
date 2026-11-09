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
  /** What the tab shows. Derived from turn and waitingOn. */
  state: AgentState;
  /** Where the main agent's turn is: running, finished, or ended by an API error. */
  turn: 'working' | 'idle' | 'error';
  /** Agents with an open permission prompt or question ('' is the main agent, else an agent_id). */
  waitingOn: string[];
  /**
   * Set by Esc. Tool events from the interrupted turn can still arrive after
   * the keypress; they are ignored until a new prompt, Stop or session.
   */
  interrupted: boolean;
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

function newAgent(sessionId: string, cwd: string | undefined): TabAgent {
  return { sessionId, cwd, state: 'idle', turn: 'idle', waitingOn: [], interrupted: false, backgroundTasks: [] };
}

/** Recomputes the shown state. Returns `prev` itself when nothing changed, so callers can skip updates. */
function finish(prev: TabAgent | undefined, next: TabAgent): TabAgent {
  const state: AgentState = next.waitingOn.length || next.turn === 'error' ? 'needsYou' : next.turn;
  const out = { ...next, state };
  if (
    prev &&
    prev.sessionId === out.sessionId &&
    prev.cwd === out.cwd &&
    prev.state === out.state &&
    prev.turn === out.turn &&
    prev.interrupted === out.interrupted &&
    prev.backgroundTasks === out.backgroundTasks &&
    prev.waitingOn.join() === out.waitingOn.join()
  ) {
    return prev;
  }
  return out;
}

const without = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : list);
const withId = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);

/**
 * Applies one hook event to a tab's agent. Returns undefined when the tab no
 * longer has a Claude session (SessionEnd).
 *
 * | Event                                        | Effect                                              |
 * |----------------------------------------------|-----------------------------------------------------|
 * | SessionStart                                 | new session, idle (compact keeps state)             |
 * | UserPromptSubmit                             | working; clears the main agent's open prompt        |
 * | Pre/PostToolUse(Failure)                     | that agent's open prompt is answered; main: working |
 * | PermissionRequest, Notification permission_prompt | that agent waits on you (needs you)            |
 * | Elicitation, Notification elicitation_dialog | main agent waits on you; ElicitationResult answers  |
 * | Notification idle_prompt                     | idle, unless something waits on you                 |
 * | Stop                                         | idle; records background tasks                      |
 * | StopFailure                                  | needs you (API error) until the next prompt         |
 * | SubagentStop                                 | that subagent no longer waits; background tasks     |
 * | SessionEnd                                   | no agent                                            |
 */
export function applyHookEvent(prev: TabAgent | undefined, ev: HookEvent): TabAgent | undefined {
  const name = typeof ev.hook_event_name === 'string' ? ev.hook_event_name : '';
  const sessionId = typeof ev.session_id === 'string' ? ev.session_id : '';
  if (!name || !sessionId) return prev;
  const cwd = typeof ev.cwd === 'string' ? ev.cwd : prev?.cwd;

  if (name === 'SessionStart') {
    if (ev.source === 'compact' && prev?.sessionId === sessionId) return finish(prev, { ...prev, cwd });
    return finish(undefined, newAgent(sessionId, cwd));
  }
  if (name === 'SessionEnd') return prev && prev.sessionId !== sessionId ? prev : undefined;

  // Another session's events are ignored, except a prompt you typed: that
  // proves the tab moved to a new session even if its SessionStart was missed.
  let a: TabAgent;
  if (!prev) a = newAgent(sessionId, cwd);
  else if (prev.sessionId === sessionId) a = { ...prev, cwd };
  else if (name === 'UserPromptSubmit') a = newAgent(sessionId, cwd);
  else return prev;

  const who = typeof ev.agent_id === 'string' ? ev.agent_id : '';
  const main = who === '';

  switch (name) {
    case 'UserPromptSubmit':
      return finish(prev, { ...a, turn: 'working', interrupted: false, waitingOn: without(a.waitingOn, '') });
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      // A tool event from the interrupted turn is stale; ignore it entirely.
      if (main && a.interrupted) return prev ?? finish(undefined, a);
      const next = { ...a, waitingOn: without(a.waitingOn, who) };
      if (main) next.turn = 'working';
      return finish(prev, next);
    }
    case 'PermissionRequest':
      return finish(prev, { ...a, waitingOn: withId(a.waitingOn, who) });
    case 'Elicitation':
      return finish(prev, { ...a, waitingOn: withId(a.waitingOn, '') });
    case 'ElicitationResult':
      return finish(prev, { ...a, waitingOn: without(a.waitingOn, ''), turn: a.interrupted ? a.turn : 'working' });
    case 'Notification':
      if (ev.notification_type === 'permission_prompt' || ev.notification_type === 'elicitation_dialog') {
        return finish(prev, { ...a, waitingOn: withId(a.waitingOn, who) });
      }
      if (ev.notification_type === 'idle_prompt' && a.turn === 'working') return finish(prev, { ...a, turn: 'idle' });
      return finish(prev, a);
    case 'Stop':
      if (!main) return finish(prev, a);
      return finish(prev, {
        ...a,
        turn: 'idle',
        interrupted: false,
        waitingOn: without(a.waitingOn, ''),
        backgroundTasks: backgroundTasks(ev.background_tasks),
      });
    case 'StopFailure':
      return main ? finish(prev, { ...a, turn: 'error', interrupted: false }) : finish(prev, a);
    case 'SubagentStop':
      return finish(prev, {
        ...a,
        waitingOn: without(a.waitingOn, who),
        backgroundTasks: backgroundTasks(ev.background_tasks),
      });
    default:
      return finish(prev, a);
  }
}

/**
 * You pressed Esc in the tab. Claude Code fires no hook when a turn is
 * interrupted (checked with every hook event registered, Claude Code 2.1.319),
 * so a working agent is marked idle here. Needs-you stays as is: an interrupted
 * permission prompt or question still leaves Claude waiting for you.
 */
export function applyInterrupt(agent: TabAgent | undefined): TabAgent | undefined {
  if (agent?.state !== 'working') return agent;
  return finish(agent, { ...agent, turn: 'idle', interrupted: true });
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
