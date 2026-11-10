import type { TabAgent } from '../../shared/agents';
import { agentFor, effectiveTabState } from '../../shared/agents';
import type { ResumeOffer } from '../../shared/ipc';
import type { Policy, Tab } from '../../shared/model';

/**
 * What a tab's glyph shows: Claude's state, a command running at the prompt,
 * a plain shell, a session that can be resumed, or a muted tab.
 */
export type TabGlyphKind = 'working' | 'needsYou' | 'idle' | 'command' | 'shell' | 'resumable' | 'muted';

const LABELS: Record<TabGlyphKind, string> = {
  working: 'Claude is working',
  needsYou: 'Claude needs you',
  idle: 'Claude is done',
  command: 'A command is running',
  shell: 'Shell',
  resumable: 'Claude session can be resumed',
  muted: 'Muted',
};

/** What the renderer knows about the tabs' activity. */
export interface TabActivity {
  agents: Record<string, TabAgent>;
  resume: Record<string, ResumeOffer>;
  /** Tabs running a command that counts (command tracking). */
  commands: ReadonlySet<string>;
}

export function tabGlyphKind(activity: TabActivity, tab: Tab, policy: Policy): TabGlyphKind {
  if (tab.muted) return 'muted';
  const agent = agentFor(activity.agents, tab.id);
  if (agent) return effectiveTabState(agent, policy);
  if (activity.commands.has(tab.id)) return 'command';
  return Object.hasOwn(activity.resume, tab.id) ? 'resumable' : 'shell';
}

/** A tab's state: a 6px dot in the sidebar, a 9px glyph in the tab strip. */
export function Glyph({ kind, detail }: { kind: TabGlyphKind; detail?: string }) {
  const label = detail ? `${LABELS[kind]} · ${detail}` : LABELS[kind];
  // A running command looks like Claude working: both are the agent's turn.
  const look = kind === 'command' ? 'working' : kind;
  return <span className={`glyph ${look}`} role="img" aria-label={label} title={label} />;
}

/** "2 background subagents, 1 background shell" for the work still running in a tab. */
export function backgroundSummary(tasks: { type: string }[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
  if (!counts.size) return undefined;
  return [...counts].map(([type, n]) => `${n} background ${type}${n === 1 ? '' : 's'}`).join(', ');
}
