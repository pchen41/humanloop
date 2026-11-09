// Installs and removes Humanloop's hooks in ~/.claude/settings.json, only when
// the user picks the menu item. Backs the file up first and leaves everything
// that isn't Humanloop's untouched.

import { copyFileSync, existsSync, lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { HOOK_EVENTS, hookStatus, installHooks, removeHooks, type HookStatus } from '../shared/hooks';
import { writeJsonSync } from './store';

const SETTINGS = join(homedir(), '.claude', 'settings.json');
const SHORT = '~/.claude/settings.json';

type Json = Record<string, unknown>;

/**
 * The file to read and write. If settings.json is a symlink (e.g. into a
 * dotfiles repo), that is its target, even when the target doesn't exist yet,
 * so writing never replaces the link with a plain file.
 */
function targetPath(): string {
  let path = SETTINGS;
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
  throw new Error(`${SHORT} is a symlink loop.`);
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
      return { ok: false, error: `${SHORT} does not contain a JSON object.` };
    }
    return { ok: true, path, settings: parsed as Json, text };
  } catch (err) {
    return { ok: false, error: `${SHORT} could not be read: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function currentHookStatus(): HookStatus | 'unreadable' {
  const r = read();
  return r.ok ? hookStatus(r.settings) : 'unreadable';
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

export async function installWithConfirm(win: BrowserWindow | undefined): Promise<void> {
  const r = read();
  if (!r.ok) {
    await message(win, { type: 'error', message: 'Could not install hooks', detail: r.error });
    return;
  }
  const { response } = await message(win, {
    type: 'info',
    message: 'Install Claude Code hooks?',
    detail:
      `Humanloop will add one hook for each of ${HOOK_EVENTS.length} events to ${SHORT}, after any hooks you already have` +
      `${r.text !== undefined ? ', and save a backup of the file next to it' : ''}.\n\n` +
      'The hooks only report to Humanloop from its own tabs. Anywhere else they exit at once and do nothing.\n\n' +
      'Claude sessions that are already running may need a restart to pick them up.',
    buttons: ['Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    const backup = applyChange(installHooks);
    await message(win, {
      type: 'info',
      message: 'Hooks installed',
      detail: backup ? `Backup saved to ${backup.replace(homedir(), '~')}` : `Created ${SHORT}.`,
    });
  } catch (err) {
    await message(win, { type: 'error', message: 'Could not install hooks', detail: String(err) });
  }
}

export async function removeWithConfirm(win: BrowserWindow | undefined): Promise<void> {
  const r = read();
  if (!r.ok) {
    await message(win, { type: 'error', message: 'Could not remove hooks', detail: r.error });
    return;
  }
  const { response } = await message(win, {
    type: 'question',
    message: 'Remove Claude Code hooks?',
    detail: `Humanloop's entries will be removed from ${SHORT}. Your own hooks and settings stay as they are. Without the hooks, Humanloop can't tell when Claude is working or waiting.`,
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
