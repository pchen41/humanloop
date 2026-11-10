import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandTracker, scanMarks } from '../src/main/commandTracker';

const C = (cmd: string) => `\x1b]6973;C;${cmd}\x07`;
const D = (exit: number) => `\x1b]6973;D;${exit}\x07`;
const START = { kind: 'start', command: 'make' } as const;
const END = { kind: 'end', exit: 0 } as const;

describe('scanMarks', () => {
  it('finds marks in output, in order, with the command and exit status', () => {
    expect(scanMarks('', `$ make${C('make -j8')}building…${D(2)}$ `)).toEqual({
      marks: [
        { kind: 'start', command: 'make -j8' },
        { kind: 'end', exit: 2 },
      ],
      carry: '',
    });
  });

  it('joins a mark split across chunks', () => {
    const mark = C('npm test');
    for (const at of [3, 9, mark.length - 1]) {
      const a = scanMarks('', `out${mark.slice(0, at)}`);
      expect(a.marks).toEqual([]);
      expect(scanMarks(a.carry, `${mark.slice(at)}more`).marks).toEqual([{ kind: 'start', command: 'npm test' }]);
    }
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
    const t = new CommandTracker((id, finished) => changes.push([id, finished]), () => true, 5000);
    t.mark('a', START);
    vi.advanceTimersByTime(4000);
    t.mark('a', END); // a quick command: nothing happens
    vi.advanceTimersByTime(5000);
    expect(changes).toEqual([]);
    t.mark('a', START);
    vi.advanceTimersByTime(5000);
    expect([...t.snapshot()]).toEqual(['a']);
    t.mark('a', END);
    expect(changes).toEqual([
      ['a', false],
      ['a', true],
    ]);
    expect(t.snapshot().size).toBe(0);
  });

  it("doesn't count the command that started Claude, up to the next prompt", () => {
    const changes: [string, boolean][] = [];
    const t = new CommandTracker((id, finished) => changes.push([id, finished]), () => true, 5000);
    t.mark('a', START); // claude
    vi.advanceTimersByTime(1000);
    t.ignoreCurrent('a'); // its first hook arrived
    vi.advanceTimersByTime(10_000);
    expect(t.snapshot().size).toBe(0);
    t.mark('a', END); // Claude exited: back at the prompt
    t.mark('a', START); // the next command counts again
    vi.advanceTimersByTime(5000);
    expect([...t.snapshot()]).toEqual(['a']);
    t.ignoreCurrent('a'); // claude started late in a counted command (claude after a long script)
    expect(changes).toEqual([
      ['a', false],
      ['a', false],
    ]);
  });

  it("doesn't count a command when nothing is running in the foreground (after exec zsh)", () => {
    const changes: [string, boolean][] = [];
    let busy = false;
    const t = new CommandTracker((id, finished) => changes.push([id, finished]), () => busy, 5000);
    t.mark('a', START); // exec zsh: no end mark will follow
    vi.advanceTimersByTime(10_000);
    expect(t.snapshot().size).toBe(0);
    busy = true;
    t.mark('a', END);
    t.mark('a', START);
    vi.advanceTimersByTime(5000);
    expect([...t.snapshot()]).toEqual(['a']);
  });

  it('ignores prompts with no command and stops counting when cleared', () => {
    const changes: [string, boolean][] = [];
    const t = new CommandTracker((id, finished) => changes.push([id, finished]), () => true, 5000);
    t.mark('a', END);
    t.mark('a', START);
    t.mark('b', START);
    vi.advanceTimersByTime(5000);
    t.clear('a');
    t.clear('b');
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

describe('CommandTracker details', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a running command, then its exit status until you type', () => {
    const t = new CommandTracker(() => {}, () => true, 5000);
    t.mark('a', { kind: 'start', command: 'npm run backfill' });
    vi.advanceTimersByTime(5000);
    expect(t.info().a).toMatchObject({ state: 'running', command: 'npm run backfill' });
    t.mark('a', { kind: 'end', exit: 1 });
    expect(t.info().a).toEqual({ state: 'done', command: 'npm run backfill', exit: 1 });
    t.typed('a');
    expect(t.info().a).toBeUndefined();
  });

  it("doesn't mark a quick command as finished", () => {
    const t = new CommandTracker(() => {}, () => true, 5000);
    t.mark('a', { kind: 'start', command: 'ls' });
    t.mark('a', { kind: 'end', exit: 0 });
    expect(t.info()).toEqual({});
  });
});
