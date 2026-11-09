import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonStore } from '../src/main/store';

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

  it('debounces saves and leaves no temp files behind', async () => {
    const file = tempFile();
    const store = new JsonStore<{ n: number }>(file);
    for (let n = 0; n < 50; n++) store.save({ n });
    await store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ n: 49 });
    expect(readdirSync(join(file, '..'))).toEqual(['state.json']);
  });
});
