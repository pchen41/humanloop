import type { TabAgent } from '../../shared/agents';
import { agentFor, effectiveTabState } from '../../shared/agents';
import type { CommandInfo, ResumeOffer } from '../../shared/ipc';
import type { Policy, Tab } from '../../shared/model';
import { formatDuration } from './format';

/**
 * What a tab's glyph shows: Claude's state; a command you ran, still running
 * (filled grey) or just finished (the mint "settled" ring until you type);
 * a plain shell; or a session that can be resumed. A muted tab shows its own
 * glyph, dimmed.
 */
export type TabGlyphKind = 'working' | 'needsYou' | 'idle' | 'command' | 'commandDone' | 'shell' | 'resumable';

const LABELS: Record<TabGlyphKind, string> = {
  working: 'Claude is working',
  needsYou: 'Claude needs you',
  idle: 'Claude is done',
  command: 'A command is running',
  commandDone: 'A command finished',
  shell: 'Shell',
  resumable: 'Claude session can be resumed',
};

/** What the renderer knows about the tabs' activity. */
export interface TabActivity {
  agents: Record<string, TabAgent>;
  resume: Record<string, ResumeOffer>;
  /** Commands run in tabs, past the 5-second mark or just finished. */
  commands: Record<string, CommandInfo>;
}

/** A tab's command, if the tab's rules count commands. */
function commandOf(activity: TabActivity, tabId: string, policy: Policy): CommandInfo | undefined {
  return policy.commandsBusy && Object.hasOwn(activity.commands, tabId) ? activity.commands[tabId] : undefined;
}

export function tabGlyphKind(activity: TabActivity, tab: Tab, policy: Policy): TabGlyphKind {
  const agent = agentFor(activity.agents, tab.id);
  if (agent) return effectiveTabState(agent, policy);
  const command = commandOf(activity, tab.id, policy);
  if (command) return command.state === 'running' ? 'command' : 'commandDone';
  return Object.hasOwn(activity.resume, tab.id) ? 'resumable' : 'shell';
}

/**
 * The tooltip for a tab's glyph: its state, the command and how long it has
 * run ("Running npm test · 4m 12s · agent's turn until it ends") or how it
 * ended ("npm test finished, exit 0"), what is still running in the
 * background, and "muted" for a muted tab.
 */
export function tabGlyphLabel(activity: TabActivity, tab: Tab, policy: Policy, now: number): string {
  const kind = tabGlyphKind(activity, tab, policy);
  const command = commandOf(activity, tab.id, policy);
  let label = LABELS[kind];
  if (command?.state === 'running' && kind === 'command') {
    // A muted tab doesn't decide whose turn it is.
    const turn = tab.muted ? '' : " · agent's turn until it ends";
    label = `Running ${command.command || 'a command'} · ${formatDuration(now - command.since)}${turn}`;
  } else if (command?.state === 'done' && kind === 'commandDone') {
    label = `${command.command || 'A command'} finished${command.exit === undefined ? '' : `, exit ${command.exit}`}`;
  }
  const agent = agentFor(activity.agents, tab.id);
  const background = agent ? backgroundSummary(agent.backgroundTasks) : undefined;
  if (background) label += ` · ${background}`;
  return tab.muted ? `${label} — muted` : label;
}

/** A tab's state: a 6px dot in the sidebar, a 9px glyph in the tab strip. */
export function Glyph({ kind, muted, label }: { kind: TabGlyphKind; muted?: boolean; label?: string }) {
  const text = label ?? LABELS[kind];
  return <span className={`glyph ${kind}${muted ? ' muted' : ''}`} role="img" aria-label={text} title={text} />;
}

/** "2 background subagents, 1 background shell" for the work still running in a tab. */
export function backgroundSummary(tasks: { type: string }[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
  if (!counts.size) return undefined;
  return [...counts].map(([type, n]) => `${n} background ${type}${n === 1 ? '' : 's'}`).join(', ');
}
