// JSON file persistence. Writes are debounced, serialized and atomic
// (temp file + rename), so a crash never leaves a half-written file.

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEBOUNCE_MS = 250;
const RETRY_MS = 5000;

let tmpCounter = 0;
function tmpPath(file: string): string {
  return `${file}.tmp-${process.pid}-${++tmpCounter}`;
}

/**
 * Reads a JSON file through `normalize`. A file that can't be read is moved
 * aside, never overwritten, and `onUnreadable` says where it went.
 */
export function readJson<T>(
  file: string,
  fallback: T,
  normalize: (raw: unknown) => T,
  onUnreadable?: (aside: string, error: string) => void,
): T {
  if (!existsSync(file)) return fallback;
  try {
    return normalize(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    const aside = `${file}.unreadable-${Date.now()}`;
    try {
      renameSync(file, aside);
    } catch {
      // ignore
    }
    console.error(`Could not read ${file}; moved it to ${aside}:`, err);
    onUnreadable?.(aside, err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

/**
 * Reads a JSON object without ever moving the file, for files you edit by
 * hand: a half-finished edit must not make the file disappear. Undefined if
 * the file is missing; an error message if it can't be parsed.
 */
export function readJsonObject(file: string): { value: Record<string, unknown> | undefined } | { error: string } {
  if (!existsSync(file)) return { value: undefined };
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { error: 'It is not a JSON object.' };
    return { value: parsed as Record<string, unknown> };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The file a path finally points at, following symlinks (even to a file that
 * doesn't exist yet), so a write updates it instead of replacing the link.
 */
export function symlinkTarget(path: string): string {
  let p = path;
  for (let i = 0; i < 16; i++) {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return p;
    }
    if (!st.isSymbolicLink()) return p;
    p = resolve(dirname(p), readlinkSync(p));
  }
  return path; // a loop: write the path itself
}

/** `mode` sets the new file's permissions (e.g. to keep a private file private). */
export function writeJsonSync(file: string, value: unknown, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = tmpPath(file);
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', mode === undefined ? undefined : { mode });
  if (mode !== undefined) chmodSync(tmp, mode); // writeFile's mode is filtered by the umask
  renameSync(tmp, file);
}

export class JsonStore<T> {
  /** Newest value not yet known to be on disk. */
  private latest: T | undefined;
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  save(value: T): void {
    this.latest = value;
    if (!this.timer) this.timer = setTimeout(() => void this.write(), DEBOUNCE_MS);
  }

  /** Writes the newest value. Writes run one at a time, in order. */
  private write(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.chain = this.chain.then(async () => {
      const value = this.latest;
      if (value === undefined) return;
      const tmp = tmpPath(this.file);
      try {
        await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
        await rename(tmp, this.file);
        // Only clear it if nothing newer arrived while writing.
        if (this.latest === value) this.latest = undefined;
      } catch (err) {
        console.error(`Could not save ${this.file}:`, err);
        await unlink(tmp).catch(() => {});
        // Keep the value pending and try again later.
        if (!this.timer) this.timer = setTimeout(() => void this.write(), RETRY_MS);
      }
    });
    return this.chain;
  }

  /**
   * Writes until the newest value is on disk, including any that arrive while
   * writing. Call before quitting. False if a write failed; the value stays
   * pending and its retry stays scheduled, in case the app keeps running.
   */
  async flush(): Promise<boolean> {
    await this.chain; // a write already in progress
    // A few rounds at most: a value that arrives mid-write needs one more.
    for (let round = 0; round < 5 && this.latest !== undefined; round++) {
      const pending = this.latest;
      await this.write();
      if (this.latest === pending) return false; // that write failed
    }
    if (this.latest !== undefined) return false;
    clearTimeout(this.timer);
    this.timer = undefined;
    return true;
  }

  /**
   * Last-resort synchronous write for when the app is exiting without
   * waiting. Prefer flush(), which cannot race with a write in progress.
   */
  flushSync(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.latest !== undefined) {
      writeJsonSync(this.file, this.latest);
      this.latest = undefined;
    }
  }
}
