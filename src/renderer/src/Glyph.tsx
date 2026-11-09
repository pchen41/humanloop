import type { TabAgent } from '../../shared/agents';
import { agentFor, effectiveTabState } from '../../shared/agents';
import type { ResumeOffer } from '../../shared/ipc';
import type { Policy } from '../../shared/model';

/** What a tab's glyph shows: Claude's state, a plain shell, or a session that can be resumed. */
export type TabGlyphKind = 'working' | 'needsYou' | 'idle' | 'shell' | 'resumable';

const LABELS: Record<TabGlyphKind, string> = {
  working: 'Claude is working',
  needsYou: 'Claude needs you',
  idle: 'Claude is done',
  shell: 'Shell',
  resumable: 'Claude session can be resumed',
};

export function tabGlyphKind(
  agents: Record<string, TabAgent>,
  resume: Record<string, ResumeOffer>,
  tabId: string,
  policy: Policy,
): TabGlyphKind {
  const agent = agentFor(agents, tabId);
  if (agent) return effectiveTabState(agent, policy);
  return Object.hasOwn(resume, tabId) ? 'resumable' : 'shell';
}

/** A tab's state: a 6px dot in the sidebar, a 9px glyph in the tab strip. */
export function Glyph({ kind, detail }: { kind: TabGlyphKind; detail?: string }) {
  const label = detail ? `${LABELS[kind]} · ${detail}` : LABELS[kind];
  return <span className={`glyph ${kind}`} role="img" aria-label={label} title={label} />;
}

/** "2 background subagents, 1 background shell" for the work still running in a tab. */
export function backgroundSummary(tasks: { type: string }[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
  if (!counts.size) return undefined;
  return [...counts].map(([type, n]) => `${n} background ${type}${n === 1 ? '' : 's'}`).join(', ');
}
