// Installs and removes Humanloop's hooks in ~/.claude/settings.json, only when
// the user picks the menu item. Backs the file up first and leaves everything
// that isn't Humanloop's untouched.

import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { HOOK_EVENTS, hookStatus, installHooks, removeHooks } from '../shared/hooks';
import type { HookState } from '../shared/ipc';
import { writeJsonSync } from './store';

/**
 * Claude Code's config folder: $CLAUDE_CONFIG_DIR if your shell sets it,
 * else ~/.claude. Read from a login shell, because that's the environment
 * Claude runs in inside Humanloop's tabs (the app itself may have been opened
 * from Finder, without your shell's variables).
 */
let configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
/** Settles once the login shell has been asked; install and remove wait for it. */
let configReady: Promise<void> | undefined;

/**
 * Asks a login shell for $CLAUDE_CONFIG_DIR. The shell starts with the
 * variables a tab gets, including one set when Humanloop was launched, so its
 * answer is what Claude sees in a tab. Runs once; later calls share it.
 */
export function resolveClaudeConfigDir(): Promise<void> {
  configReady ??= new Promise((done) => {
    const MARK = '__humanloop_config_dir__';
    const env: Record<string, string> = { HOME: homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TERM: 'dumb' };
    for (const name of ['CLAUDE_CONFIG_DIR', 'ZDOTDIR', 'USER', 'LOGNAME', 'SHELL']) {
      const v = process.env[name];
      if (v) env[name] = v;
    }
    execFile('/bin/zsh', ['-lic', `printf '\\n${MARK}%s\\n' "$CLAUDE_CONFIG_DIR"`], { timeout: 5000, env }, (_err, stdout) => {
      const line = String(stdout ?? '').split('\n').find((l) => l.startsWith(MARK));
      const dir = line?.slice(MARK.length).trim();
      if (line !== undefined) configDir = dir ? resolve(homedir(), dir.replace(/^~(?=\/|$)/, homedir())) : join(homedir(), '.claude');
      done();
    });
  });
  return configReady;
}

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
function shortPath(): string {
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
  // Installed, but Claude is told not to run them: by your settings, or by
  // your organisation's managed settings (which can also allow only their own hooks).
  const managed = readManaged();
  const off = r.settings.disableAllHooks === true || managed.disableAllHooks === true || managed.allowManagedHooksOnly === true;
  if (status !== 'missing' && off) return 'disabled';
  return status;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Re-reads the file right before writing, so edits made while a dialog was
 * open (by you or by Claude Code) are kept, then backs it up and writes the
 * change with the same permissions. Returns the backup path, if any.
 */
export function applyChange(change: (settings: Json) => Json, expectedPath?: string): string | undefined {
  const r = read();
  if (!r.ok) throw new Error(r.error);
  // The file you confirmed is the file that gets written.
  if (expectedPath !== undefined && r.path !== expectedPath) {
    throw new Error(`Claude Code's settings moved to ${r.path} while the dialog was open. Nothing was changed; try again.`);
  }
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
  await resolveClaudeConfigDir();
  const r = read();
  if (!r.ok) {
    await message(win, { type: 'error', message: 'Could not install hooks', detail: r.error });
    return;
  }
  const { response } = await message(win, {
    type: 'info',
    message: 'Install Claude Code hooks?',
    detail:
      `Humanloop will add one hook for each of ${HOOK_EVENTS.length} events to ${shortPath()}, after any hooks you already have` +
      `${r.text !== undefined ? ', and save a backup of the file next to it' : ''}.\n\n` +
      'The hooks only report to Humanloop from its own tabs. Anywhere else they exit at once and do nothing.\n\n' +
      'Claude sessions that are already running may need a restart to pick them up.',
    buttons: ['Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    const backup = applyChange(installHooks, r.path);
    await message(win, {
      type: 'info',
      message: 'Hooks installed',
      detail: backup ? `Backup saved to ${backup.replace(homedir(), '~')}` : `Created ${shortPath()}.`,
    });
  } catch (err) {
    await message(win, { type: 'error', message: 'Could not install hooks', detail: String(err) });
  }
}

export async function removeWithConfirm(win: BrowserWindow | undefined): Promise<void> {
  await resolveClaudeConfigDir();
  const r = read();
  if (!r.ok) {
    await message(win, { type: 'error', message: 'Could not remove hooks', detail: r.error });
    return;
  }
  const { response } = await message(win, {
    type: 'question',
    message: 'Remove Claude Code hooks?',
    detail: `Humanloop's entries will be removed from ${shortPath()}. Your own hooks and settings stay as they are. Without the hooks, Humanloop can't tell when Claude is working or waiting.`,
    buttons: ['Remove', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    applyChange(removeHooks, r.path);
  } catch (err) {
    await message(win, { type: 'error', message: 'Could not remove hooks', detail: String(err) });
  }
}
