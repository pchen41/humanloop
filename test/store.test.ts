import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonStore, readJsonObject } from '../src/main/store';

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'humanloop-store-')), 'state.json');
}

describe('JsonStore', () => {
  it('flush writes the newest value even while an earlier write is in progress', async () => {
    const file = tempFile();
    const store = new JsonStore<{ n: number }>(file);
    store.save({ n: 1 });
    const first = store.flush(); // starts writing n=1
    store.save({ n: 2 }); // arrives mid-write
    await first;
    await store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ n: 2 });
  });

  it('flush says when the newest value could not be written', async () => {
    const file = tempFile();
    const store = new JsonStore<{ n: number }>(file);
    store.save({ n: 1 });
    expect(await store.flush()).toBe(true);
    chmodSync(join(file, '..'), 0o500); // the folder can't take new files
    try {
      store.save({ n: 2 });
      expect(await store.flush()).toBe(false);
    } finally {
      chmodSync(join(file, '..'), 0o700);
    }
    expect(await store.flush()).toBe(true); // and it's still pending, so a later flush writes it
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ n: 2 });
  });

  it('debounces saves and leaves no temp files behind', async () => {
    const file = tempFile();
    const store = new JsonStore<{ n: number }>(file);
    for (let n = 0; n < 50; n++) store.save({ n });
    await store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ n: 49 });
    expect(readdirSync(join(file, '..'))).toEqual(['state.json']);
  });
});

describe('readJsonObject', () => {
  it('never moves a file it cannot parse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hl-'));
    const file = join(dir, 'settings.json');
    expect(readJsonObject(file)).toEqual({ value: undefined });
    writeFileSync(file, '{ "policy": { }, }');
    expect('error' in readJsonObject(file)).toBe(true);
    expect(existsSync(file)).toBe(true);
    writeFileSync(file, '[]');
    expect('error' in readJsonObject(file)).toBe(true);
    writeFileSync(file, '{"a":1}');
    expect(readJsonObject(file)).toEqual({ value: { a: 1 } });
  });
});
