// Checks Claude Code's settings.json for what affects Humanloop's hooks (an
// older version's entries, hooks turned off), and removes those old entries
// when you ask. Backs the file up first and leaves everything that isn't
// Humanloop's untouched.

import { copyFileSync, existsSync, lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { hookStatus, removeHooks } from '../shared/hooks';
import type { HookState } from '../shared/ipc';
import { writeJsonSync } from './store';

/**
 * Claude Code's config folder: $CLAUDE_CONFIG_DIR if Humanloop was started
 * with it set, else ~/.claude. Settings shows the path, so a different setup
 * is easy to spot.
 */
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

/** Claude Code's managed (organisation-wide) settings on macOS, if any. */
function readManaged(): Json {
  try {
    const parsed: unknown = JSON.parse(readFileSync('/Library/Application Support/ClaudeCode/managed-settings.json', 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

function settingsFile(): string {
  return join(configDir, 'settings.json');
}

/** The settings file as shown to you, with ~ for your home folder. */
export function shortPath(): string {
  const p = settingsFile();
  return p.startsWith(homedir() + '/') ? `~${p.slice(homedir().length)}` : p;
}

type Json = Record<string, unknown>;

/**
 * The file to read and write. If settings.json is a symlink (e.g. into a
 * dotfiles repo), that is its target, even when the target doesn't exist yet,
 * so writing never replaces the link with a plain file.
 */
function targetPath(): string {
  let path = settingsFile();
  for (let i = 0; i < 16; i++) {
    let st;
    try {
      st = lstatSync(path);
    } catch {
      return path; // doesn't exist (yet)
    }
    if (!st.isSymbolicLink()) return path;
    path = resolve(dirname(path), readlinkSync(path));
  }
  throw new Error(`${shortPath()} is a symlink loop.`);
}

type ReadResult = { ok: true; path: string; settings: Json; text: string | undefined } | { ok: false; error: string };

function read(): ReadResult {
  let path: string;
  try {
    path = targetPath();
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
  if (!existsSync(path)) return { ok: true, path, settings: {}, text: undefined };
  try {
    const text = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `${shortPath()} does not contain a JSON object.` };
    }
    return { ok: true, path, settings: parsed as Json, text };
  } catch (err) {
    return { ok: false, error: `${shortPath()} could not be read: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function currentHookStatus(): HookState {
  const r = read();
  if (!r.ok) return 'unreadable';
  const status = hookStatus(r.settings);
  // Claude is told not to run hooks: by your settings, or by your
  // organisation's managed settings (which can also allow only their own).
  const managed = readManaged();
  const off = r.settings.disableAllHooks === true || managed.disableAllHooks === true || managed.allowManagedHooksOnly === true;
  return off ? 'disabled' : status;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Re-reads the file right before writing, so edits made while a dialog was
 * open (by you or by Claude Code) are kept, then backs it up and writes the
 * change with the same permissions. Returns the backup path, if any.
 */
export function applyChange(change: (settings: Json) => Json): string | undefined {
  const r = read();
  if (!r.ok) throw new Error(r.error);
  let backup: string | undefined;
  let mode: number | undefined;
  if (r.text !== undefined) {
    mode = statSync(r.path).mode & 0o777;
    backup = `${r.path}.humanloop-backup-${stamp()}`;
    copyFileSync(r.path, backup);
  }
  writeJsonSync(r.path, change(r.settings), mode ?? 0o600);
  return backup;
}

async function message(win: BrowserWindow | undefined, opts: Electron.MessageBoxOptions) {
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

export async function removeWithConfirm(win: BrowserWindow | undefined): Promise<void> {
  const r = read();
  if (!r.ok) {
    await message(win, { type: 'error', message: 'Could not remove hooks', detail: r.error });
    return;
  }
  const { response } = await message(win, {
    type: 'question',
    message: 'Remove the old Claude Code hooks?',
    detail: `An older version of Humanloop added hooks to ${shortPath()}. They're no longer needed: Humanloop now gives its hooks to claude in its own tabs. Only Humanloop's entries are removed; your own hooks and settings stay as they are.`,
    buttons: ['Remove', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    applyChange(removeHooks);
  } catch (err) {
    await message(win, { type: 'error', message: 'Could not remove hooks', detail: String(err) });
  }
}
