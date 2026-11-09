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
  /** Tool calls that have started and not yet finished, as "<agent>|tool:<name>:<input fingerprint>". */
  started: string[];
  /**
   * Set by Esc or Ctrl-C. Tool events from the interrupted turn can still
   * arrive after the keypress, so the main agent's tool events are ignored
   * until your next prompt or Claude's Stop. (A tool event can't be told
   * apart from one Claude started afterwards, e.g. if Esc only closed a menu;
   * then the tab shows idle until that turn's Stop, which is the safer error.)
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
  is_interrupt?: unknown;
  mcp_server_name?: unknown;
  server_name?: unknown;
  elicitation_id?: unknown;
  request_id?: unknown;
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
  return { sessionId, cwd, state: 'idle', turn: 'idle', waitingOn: [], started: [], interrupted: false, backgroundTasks: [] };
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
    prev.waitingOn.join() === out.waitingOn.join() &&
    prev.started.join() === out.started.join()
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

/** The list without one occurrence of `key` (identical parallel calls each have their own). */
function removeOne(list: string[], key: string): string[] {
  const i = list.indexOf(key);
  return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
}

/**
 * The prompts left open once a tool call finishes. It answers its own prompt,
 * matched by tool and input. If its input matches no call that started (it
 * was edited on approval), it answers the agent's only open prompt for that
 * tool. A different call finishing never answers a prompt still on screen.
 * A prompt known only from a notification closes when any of the agent's
 * tools finishes.
 */
function answeredBy(waiting: string[], started: string[], who: string, ev: HookEvent): string[] {
  const key = toolKey(who, ev);
  let left = waiting.filter((e) => e !== `${who}|notice`);
  if (left.includes(key)) return removeOne(left, key);
  if (started.includes(key)) return left; // a different call that needed no prompt
  const sameTool = `${who}|tool:${typeof ev.tool_name === 'string' ? ev.tool_name : ''}:`;
  const candidates = left.filter((e) => e.startsWith(sameTool));
  if (candidates.length === 1) left = removeOne(left, candidates[0]!);
  return left;
}

/** An MCP question's key: the agent, the server and the request, when the event names them. */
function elicitationKey(who: string, ev: HookEvent): string {
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  return `${who}|elicitation:${str(ev.mcp_server_name ?? ev.server_name)}:${str(ev.elicitation_id ?? ev.request_id)}`;
}

/** The questions left once one is answered: that one, else one from the same server, else the agent's oldest. */
function elicitationAnswered(waiting: string[], who: string, ev: HookEvent): string[] {
  const key = elicitationKey(who, ev);
  if (waiting.includes(key)) return removeOne(waiting, key);
  const server = key.slice(0, key.lastIndexOf(':') + 1);
  const match = waiting.find((e) => e.startsWith(server)) ?? waiting.find((e) => e.startsWith(`${who}|elicitation`));
  return match ? removeOne(waiting, match) : waiting;
}

/**
 * Applies one hook event to a tab's agent. Returns undefined when the tab no
 * longer has a Claude session (SessionEnd).
 *
 * | Event                                        | Effect                                              |
 * |----------------------------------------------|-----------------------------------------------------|
 * | SessionStart                                 | new session, idle (compact keeps state)             |
 * | UserPromptSubmit                             | working; every open prompt is closed                |
 * | PreToolUse                                   | records the call; main: working                     |
 * | PostToolUse(Failure)                         | answers that tool call's prompt; main: working      |
 * |   …with is_interrupt                         | main: idle, as after Esc                            |
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

  const working = main ? { turn: 'working' as const } : {};

  switch (name) {
    case 'UserPromptSubmit':
      // You can't submit a prompt while a prompt or question is on screen, so every one is closed.
      return finish(prev, { ...a, turn: 'working', interrupted: false, waitingOn: [], started: [] });
    case 'PreToolUse':
      // From the interrupted turn, possibly delivered after Esc: ignore it.
      if (main && a.interrupted) return prev ?? finish(undefined, a);
      return finish(prev, { ...a, ...working, started: [...a.started, toolKey(who, ev)].slice(-200) });
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      if (main && a.interrupted) return prev ?? finish(undefined, a);
      const waitingOn = answeredBy(a.waitingOn, a.started, who, ev);
      const started = removeOne(a.started, toolKey(who, ev));
      // A tool cut short by an interrupt ends the main agent's turn.
      if (main && ev.is_interrupt === true) {
        return finish(prev, { ...a, turn: 'idle', interrupted: true, waitingOn, started });
      }
      return finish(prev, { ...a, ...working, waitingOn, started });
    }
    case 'PermissionRequest':
      // Identical parallel calls each get their own entry, so answering one leaves the other open.
      return finish(prev, { ...a, waitingOn: [...a.waitingOn, toolKey(who, ev)] });
    case 'Elicitation':
      return finish(prev, { ...a, waitingOn: [...a.waitingOn, elicitationKey(who, ev)] });
    case 'ElicitationResult':
      return finish(prev, { ...a, waitingOn: elicitationAnswered(a.waitingOn, who, ev) });
    case 'Notification':
      if (ev.notification_type === 'permission_prompt') {
        // Usually PermissionRequest already recorded it; sandbox network prompts send only this.
        if (a.waitingOn.some(isAgent(who))) return finish(prev, a);
        return finish(prev, { ...a, waitingOn: adding(a.waitingOn, `${who}|notice`) });
      }
      if (ev.notification_type === 'elicitation_dialog') {
        // Usually Elicitation already recorded it.
        if (a.waitingOn.some((e) => e.startsWith(`${who}|elicitation`))) return finish(prev, a);
        return finish(prev, { ...a, waitingOn: [...a.waitingOn, `${who}|elicitation::`] });
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
        started: a.started.filter((e) => !isAgent('')(e)),
        backgroundTasks: backgroundTasks(ev.background_tasks),
      });
    case 'StopFailure':
      return main ? finish(prev, { ...a, turn: 'error', interrupted: false }) : finish(prev, a);
    case 'SubagentStop':
      return finish(prev, {
        ...a,
        waitingOn: a.waitingOn.filter((e) => !isAgent(who)(e)),
        started: a.started.filter((e) => !isAgent(who)(e)),
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

/**
 * The tab's agent from a snapshot keyed by tab id. Own keys only, so a tab
 * id that happens to name an Object method ("toString") finds nothing.
 */
export function agentFor(agents: Record<string, TabAgent | undefined>, tabId: string): TabAgent | undefined {
  return Object.hasOwn(agents, tabId) ? agents[tabId] : undefined;
}
