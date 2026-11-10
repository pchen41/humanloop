import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandTracker, scanMarks } from '../src/main/commandTracker';

const C = '\x1b]6973;C\x07';
const D = '\x1b]6973;D\x07';

describe('scanMarks', () => {
  it('finds marks in output, in order', () => {
    expect(scanMarks('', `$ make${C}building…${D}$ `)).toEqual({ marks: ['start', 'end'], carry: '' });
  });

  it('joins a mark split across chunks', () => {
    const a = scanMarks('', `out${C.slice(0, 4)}`);
    expect(a).toEqual({ marks: [], carry: C.slice(0, 4) });
    expect(scanMarks(a.carry, `${C.slice(4)}more`)).toEqual({ marks: ['start'], carry: '' });
  });

  it('carries nothing for other escape sequences', () => {
    expect(scanMarks('', 'red \x1b[31')).toEqual({ marks: [], carry: '' });
    expect(scanMarks('', 'title \x1b]0;')).toEqual({ marks: [], carry: '' });
  });
});

describe('CommandTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts a command only once it has run for the delay', () => {
    const changes: [string, boolean][] = [];
    const t = new CommandTracker((id, finished) => changes.push([id, finished]), 5000);
    t.mark('a', 'start');
    vi.advanceTimersByTime(4000);
    t.mark('a', 'end'); // a quick command: nothing happens
    vi.advanceTimersByTime(5000);
    expect(changes).toEqual([]);
    t.mark('a', 'start');
    vi.advanceTimersByTime(5000);
    expect([...t.snapshot()]).toEqual(['a']);
    t.mark('a', 'end');
    expect(changes).toEqual([
      ['a', false],
      ['a', true],
    ]);
    expect(t.snapshot().size).toBe(0);
  });

  it('ignores prompts with no command and stops counting when cleared', () => {
    const changes: [string, boolean][] = [];
    const t = new CommandTracker((id, finished) => changes.push([id, finished]), 5000);
    t.mark('a', 'end');
    t.mark('a', 'start');
    t.mark('b', 'start');
    vi.advanceTimersByTime(5000);
    t.clearAll();
    expect(changes).toEqual([
      ['a', false],
      ['b', false],
      ['a', false],
      ['b', false],
    ]);
    vi.advanceTimersByTime(10_000);
    expect(t.snapshot().size).toBe(0);
  });
});
