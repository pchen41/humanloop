// Humanloop's entries in Claude Code's ~/.claude/settings.json. Pure
// functions, so installing and removing can be tested without touching disk.

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
  '[ -z "$HUMANLOOP_SOCK" ] || curl -s -o /dev/null --max-time 1 --unix-socket "$HUMANLOOP_SOCK" ' +
  '-H "X-Tab: $HUMANLOOP_TAB" -H "X-Pid: $PPID" --data-binary @- http://humanloop/hook; exit 0';

/** Seconds Claude waits for the hook before giving up. */
export const HOOK_TIMEOUT = 2;

/** How Humanloop recognises its own entries, including ones from older versions. */
const MARKER = 'HUMANLOOP_SOCK';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function isOurs(handler: unknown): boolean {
  return isObj(handler) && typeof handler.command === 'string' && handler.command.includes(MARKER);
}

/** Returns a copy of `settings` without any Humanloop hooks. Everything else is kept as is. */
export function removeHooks(settings: Json): Json {
  if (!isObj(settings.hooks)) return { ...settings };
  const hooks: Json = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const kept = groups.flatMap((group) => {
      if (!isObj(group) || !Array.isArray(group.hooks)) return [group];
      const handlers = group.hooks.filter((h) => !isOurs(h));
      if (handlers.length === group.hooks.length) return [group];
      return handlers.length ? [{ ...group, hooks: handlers }] : [];
    });
    if (kept.length) hooks[event] = kept;
  }
  const out = { ...settings };
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** Returns a copy of `settings` with Humanloop's hooks added after the user's own. */
export function installHooks(settings: Json): Json {
  const clean = removeHooks(settings);
  const hooks: Json = isObj(clean.hooks) ? { ...clean.hooks } : {};
  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...existing, { hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: HOOK_TIMEOUT }] }];
  }
  return { ...clean, hooks };
}

export type HookStatus = 'installed' | 'outdated' | 'missing';

/** "outdated" means some Humanloop entries exist but not the current set. */
export function hookStatus(settings: Json): HookStatus {
  const hooks = isObj(settings.hooks) ? settings.hooks : {};
  let current = 0;
  let any = false;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isObj(group) || !Array.isArray(group.hooks)) continue;
      for (const h of group.hooks) {
        if (!isOurs(h)) continue;
        any = true;
        if (
          (HOOK_EVENTS as readonly string[]).includes(event) &&
          (h as Json).command === HOOK_COMMAND &&
          group.matcher === undefined
        ) {
          current++;
        }
      }
    }
  }
  if (current === HOOK_EVENTS.length) return 'installed';
  return any ? 'outdated' : 'missing';
}
