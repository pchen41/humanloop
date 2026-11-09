// Installs and removes Humanloop's hooks in ~/.claude/settings.json, only when
// the user picks the menu item. Backs the file up first and leaves everything
// that isn't Humanloop's untouched.

import { copyFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { HOOK_EVENTS, hookStatus, installHooks, removeHooks, type HookStatus } from '../shared/hooks';
import { writeJsonSync } from './store';

const SETTINGS = join(homedir(), '.claude', 'settings.json');
const SHORT = '~/.claude/settings.json';

type Json = Record<string, unknown>;

function read(): { ok: true; settings: Json; exists: boolean } | { ok: false; error: string } {
  if (!existsSync(SETTINGS)) return { ok: true, settings: {}, exists: false };
  try {
    const parsed: unknown = JSON.parse(readFileSync(SETTINGS, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `${SHORT} does not contain a JSON object.` };
    }
    return { ok: true, settings: parsed as Json, exists: true };
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

/** Writes through a symlink (e.g. a dotfiles repo) instead of replacing it. */
function write(settings: Json, existed: boolean): string | undefined {
  const target = existed ? realpathSync(SETTINGS) : SETTINGS;
  let backup: string | undefined;
  if (existed) {
    backup = `${target}.humanloop-backup-${stamp()}`;
    copyFileSync(target, backup);
  }
  writeJsonSync(target, settings);
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
      `${r.exists ? ', and save a backup of the file next to it' : ''}.\n\n` +
      'The hooks only report to Humanloop from its own tabs. Anywhere else they exit at once and do nothing.\n\n' +
      'Claude sessions that are already running may need a restart to pick them up.',
    buttons: ['Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    const backup = write(installHooks(r.settings), r.exists);
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
    write(removeHooks(r.settings), r.exists);
  } catch (err) {
    await message(win, { type: 'error', message: 'Could not remove hooks', detail: String(err) });
  }
}
