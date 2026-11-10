// Humanloop's Claude Code hooks. Each tab's zsh passes them to `claude` with
// --settings (see shellIntegration.ts), so nothing is added to Claude Code's
// own settings.

/** Events Humanloop listens to. See the event table in agents.ts. */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Elicitation',
  'ElicitationResult',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStop',
  'SessionEnd',
] as const;

export type HookEventName = (typeof HOOK_EVENTS)[number];

/**
 * One inline command for every event. Outside Humanloop HUMANLOOP_SOCK is
 * unset and it exits at once; if the app has quit, curl fails fast. It always
 * exits 0 and prints nothing, so it can never block or steer Claude.
 */
export const HOOK_COMMAND =
  // -q (first) skips ~/.curlrc, whose options (like -w) could print into Claude's context.
  '[ -z "$HUMANLOOP_SOCK" ] || curl -q -s -o /dev/null --max-time 1.8 --unix-socket "$HUMANLOOP_SOCK" ' +
  '-H "X-Tab: $HUMANLOOP_TAB" -H "X-Pid: $PPID" --data-binary @- http://humanloop/hook; exit 0';

/** Seconds Claude waits for the hook before giving up. */
export const HOOK_TIMEOUT = 2;

/**
 * The settings Humanloop passes to `claude` in its tabs (as inline JSON with
 * --settings): one hook per event. Claude Code adds them to your own hooks.
 */
export function hookSettings(): string {
  const handler = { type: 'command', command: HOOK_COMMAND, timeout: HOOK_TIMEOUT };
  return JSON.stringify({ hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [handler] }]])) });
}
