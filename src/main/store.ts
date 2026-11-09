// JSON file persistence. Writes are debounced, serialized and atomic
// (temp file + rename), so a crash never leaves a half-written file.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEBOUNCE_MS = 250;

let tmpCounter = 0;
function tmpPath(file: string): string {
  return `${file}.tmp-${process.pid}-${++tmpCounter}`;
}

export function readJson<T>(file: string, fallback: T, normalize: (raw: unknown) => T): T {
  if (!existsSync(file)) return fallback;
  try {
    return normalize(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    // Keep the unreadable file for the user instead of overwriting it.
    const aside = `${file}.unreadable-${Date.now()}`;
    try {
      renameSync(file, aside);
    } catch {
      // ignore
    }
    console.error(`Could not read ${file}; moved it to ${aside}:`, err);
    return fallback;
  }
}

export function writeJsonSync(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = tmpPath(file);
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}

export class JsonStore<T> {
  private latest: T | undefined;
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();
  /** Bumped by every write, so an older async write never lands over a newer one. */
  private generation = 0;

  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  save(value: T): void {
    this.latest = value;
    if (!this.timer) this.timer = setTimeout(() => this.writeLatest(), DEBOUNCE_MS);
  }

  private writeLatest(): void {
    this.timer = undefined;
    const value = this.latest;
    if (value === undefined) return;
    this.latest = undefined;
    const json = JSON.stringify(value, null, 2) + '\n';
    const gen = ++this.generation;
    this.chain = this.chain
      .then(async () => {
        const tmp = tmpPath(this.file);
        await writeFile(tmp, json);
        if (gen === this.generation) await rename(tmp, this.file);
        else await unlink(tmp);
      })
      .catch((err) => console.error(`Could not save ${this.file}:`, err));
  }

  /** Writes any pending value right away. Called on quit. */
  flushSync(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.latest !== undefined) {
      this.generation++;
      writeJsonSync(this.file, this.latest);
      this.latest = undefined;
    }
  }
}
