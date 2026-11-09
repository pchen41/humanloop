import type { TaskAgentState } from '../../shared/agents';

const LABELS: Record<Exclude<TaskAgentState, 'none'>, string> = {
  working: 'Claude is working',
  needsYou: 'Claude needs you',
  idle: 'Claude is done and waiting',
};

/** A small dot showing what Claude is doing. Nothing for tabs or tasks without Claude. */
export function AgentDot({ state, detail }: { state: TaskAgentState; detail?: string }) {
  if (state === 'none') return <span className="agent-dot none" aria-hidden />;
  const label = detail ? `${LABELS[state]} · ${detail}` : LABELS[state];
  return <span className={`agent-dot ${state}`} role="img" aria-label={label} title={label} />;
}

/** "2 background subagents, 1 background shell" for the work still running in a tab. */
export function backgroundSummary(tasks: { type: string }[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
  if (!counts.size) return undefined;
  return [...counts].map(([type, n]) => `${n} background ${type}${n === 1 ? '' : 's'}`).join(', ');
}
