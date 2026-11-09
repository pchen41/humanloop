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
  /**
   * Open permission prompts and questions, one entry each, as "<agent>|<what>":
   * the agent is '' for the main agent, else its agent_id; what is the tool
   * call it asks about, "elicitation", or "notice" for a prompt known only from
   * a notification.
   */
  waitingOn: string[];
  /**
   * Set by Esc. A tool from the interrupted turn can still report finishing
   * after the keypress; those reports are ignored until Claude starts
   * something new (a prompt, a tool, a question) or stops.
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
  tool_name?: unknown;
  tool_input?: unknown;
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

/** A short stable fingerprint of a value (key order doesn't matter). */
function fingerprint(v: unknown): string {
  const stable = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(stable)
      : typeof x === 'object' && x !== null
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, stable((x as Record<string, unknown>)[k])]),
          )
        : x;
  const text = JSON.stringify(stable(v)) ?? '';
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const toolKey = (who: string, ev: HookEvent) =>
  `${who}|tool:${typeof ev.tool_name === 'string' ? ev.tool_name : ''}:${fingerprint(ev.tool_input)}`;
const isAgent = (who: string) => (entry: string) => entry.startsWith(`${who}|`);

const adding = (list: string[], key: string) => (list.includes(key) ? list : [...list, key]);

/**
 * The prompts a finished tool call answers: its own (matched by tool and
 * input), or, if the input was changed on approval, the agent's only open
 * prompt for that tool; plus any notification-only prompt of that agent.
 * Another tool finishing never answers a prompt that is still on screen.
 */
function answeredBy(list: string[], who: string, ev: HookEvent): string[] {
  const exact = toolKey(who, ev);
  const sameTool = `${who}|tool:${typeof ev.tool_name === 'string' ? ev.tool_name : ''}:`;
  const candidates = list.filter((e) => e.startsWith(sameTool));
  const answered = new Set([`${who}|notice`]);
  if (list.includes(exact)) answered.add(exact);
  else if (candidates.length === 1) answered.add(candidates[0]!);
  return list.filter((e) => !answered.has(e));
}

/**
 * Applies one hook event to a tab's agent. Returns undefined when the tab no
 * longer has a Claude session (SessionEnd).
 *
 * | Event                                        | Effect                                              |
 * |----------------------------------------------|-----------------------------------------------------|
 * | SessionStart                                 | new session, idle (compact keeps state)             |
 * | UserPromptSubmit                             | working; every open prompt is closed                |
 * | PreToolUse                                   | main: working                                       |
 * | PostToolUse(Failure)                         | answers that tool call's prompt; main: working      |
 * | PermissionRequest, Notification permission_prompt | that agent waits on you (needs you)            |
 * | Elicitation, Notification elicitation_dialog | that agent waits on you; ElicitationResult answers  |
 * | Notification idle_prompt                     | idle, unless something waits on you                 |
 * | Stop                                         | idle; main prompts close; records background tasks  |
 * | StopFailure                                  | needs you (API error) until the next prompt         |
 * | SubagentStop                                 | that subagent no longer waits; background tasks     |
 * | SessionEnd                                   | no agent                                            |
 */
export function applyHookEvent(prev: TabAgent | undefined, ev: HookEvent): TabAgent | undefined {
  const name = typeof ev.hook_event_name === 'string' ? ev.hook_event_name : '';
  const sessionId = typeof ev.session_id === 'string' ? ev.session_id : '';
  if (!name || !sessionId) return prev;
  // The session's directory as it started, which is where `claude --resume`
  // finds it; later events report wherever Claude has cd'd to since.
  const cwd = typeof ev.cwd === 'string' ? ev.cwd : undefined;

  if (name === 'SessionStart') {
    if (ev.source === 'compact' && prev?.sessionId === sessionId) return finish(prev, prev);
    return finish(undefined, newAgent(sessionId, cwd));
  }
  if (name === 'SessionEnd') return prev && prev.sessionId !== sessionId ? prev : undefined;

  // Another session's events are ignored, except a prompt you typed: that
  // proves the tab moved to a new session even if its SessionStart was missed.
  let a: TabAgent;
  if (!prev) a = newAgent(sessionId, cwd);
  else if (prev.sessionId === sessionId) a = prev;
  else if (name === 'UserPromptSubmit') a = newAgent(sessionId, cwd);
  else return prev;

  const who = typeof ev.agent_id === 'string' ? ev.agent_id : '';
  const main = who === '';

  // Starting something new (a tool, a prompt, a question) proves the main
  // agent is running again, e.g. after an Esc that only closed a menu.
  const resumed = main ? { interrupted: false, turn: 'working' as const } : {};

  switch (name) {
    case 'UserPromptSubmit':
      // You can't submit a prompt while a prompt or question is on screen, so every one is closed.
      return finish(prev, { ...a, turn: 'working', interrupted: false, waitingOn: [] });
    case 'PreToolUse':
      return finish(prev, { ...a, ...resumed });
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      // A tool finishing from an interrupted turn is stale; ignore it entirely.
      if (main && a.interrupted) return prev ?? finish(undefined, a);
      return finish(prev, { ...a, ...resumed, waitingOn: answeredBy(a.waitingOn, who, ev) });
    }
    case 'PermissionRequest':
      return finish(prev, { ...a, ...resumed, waitingOn: adding(a.waitingOn, toolKey(who, ev)) });
    case 'Elicitation':
      return finish(prev, { ...a, ...resumed, waitingOn: adding(a.waitingOn, `${who}|elicitation`) });
    case 'ElicitationResult':
      return finish(prev, { ...a, waitingOn: a.waitingOn.filter((e) => e !== `${who}|elicitation`) });
    case 'Notification':
      if (ev.notification_type === 'permission_prompt') {
        // Usually PermissionRequest already recorded it; sandbox network prompts send only this.
        if (a.waitingOn.some(isAgent(who))) return finish(prev, a);
        return finish(prev, { ...a, waitingOn: adding(a.waitingOn, `${who}|notice`) });
      }
      if (ev.notification_type === 'elicitation_dialog') {
        return finish(prev, { ...a, waitingOn: adding(a.waitingOn, `${who}|elicitation`) });
      }
      if (ev.notification_type === 'idle_prompt' && a.turn === 'working') return finish(prev, { ...a, turn: 'idle' });
      return finish(prev, a);
    case 'Stop':
      if (!main) return finish(prev, a);
      return finish(prev, {
        ...a,
        turn: 'idle',
        interrupted: false,
        // The main agent's turn is over, so nothing it asked is still open; subagents may still be waiting.
        waitingOn: a.waitingOn.filter((e) => !isAgent('')(e)),
        backgroundTasks: backgroundTasks(ev.background_tasks),
      });
    case 'StopFailure':
      return main ? finish(prev, { ...a, turn: 'error', interrupted: false }) : finish(prev, a);
    case 'SubagentStop':
      return finish(prev, {
        ...a,
        waitingOn: a.waitingOn.filter((e) => !isAgent(who)(e)),
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
