// Reads Claude Code's settings for whether hooks can run at all. Humanloop's
// own hooks are passed to claude in its tabs (see shellIntegration.ts), so it
// never writes to these files.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HookState } from '../shared/ipc';

type Json = Record<string, unknown>;

/**
 * Claude Code's config folder: $CLAUDE_CONFIG_DIR if Humanloop was started
 * with it set, else ~/.claude. Settings shows the path, so a different setup
 * is easy to spot.
 */
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

function settingsFile(): string {
  return join(configDir, 'settings.json');
}

/** The settings file as shown to you, with ~ for your home folder. */
export function shortPath(): string {
  const p = settingsFile();
  return p.startsWith(homedir() + '/') ? `~${p.slice(homedir().length)}` : p;
}

/** A JSON object from a file: {} if it's missing, undefined if it can't be read or isn't an object. */
function readObject(path: string): Json | undefined {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether Claude runs hooks: 'disabled' if your settings or your
 * organisation's managed settings turn them off (managed settings can also
 * allow only their own), 'unreadable' if your settings.json isn't valid JSON.
 */
export function currentHookState(): HookState {
  const mine = readObject(settingsFile());
  const managed = readObject('/Library/Application Support/ClaudeCode/managed-settings.json') ?? {};
  if (managed.disableAllHooks === true || managed.allowManagedHooksOnly === true || mine?.disableAllHooks === true) return 'disabled';
  return mine ? 'ok' : 'unreadable';
}
