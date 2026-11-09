import type { TaskAgentState } from '../../shared/agents';

const LABELS: Record<Exclude<TaskAgentState, 'none'>, string> = {
  working: 'Claude is working',
  needsYou: 'Claude needs you',
  idle: 'Claude is done and waiting',
};

/** A small dot showing what Claude is doing. Nothing for tabs or tasks without Claude. */
export function AgentDot({ state }: { state: TaskAgentState }) {
  if (state === 'none') return <span className="agent-dot none" aria-hidden />;
  return <span className={`agent-dot ${state}`} role="img" aria-label={LABELS[state]} title={LABELS[state]} />;
}
