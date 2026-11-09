import { describe, expect, it } from 'vitest';
import { acceleratorKeys, formatWait, linkify } from '../src/renderer/src/format';

describe('linkify', () => {
  const links = (text: string) => linkify(text).filter((p) => p.href).map((p) => p.href);

  it('keeps balanced brackets and drops sentence punctuation', () => {
    expect(links('See https://en.wikipedia.org/wiki/Mercury_(planet).')).toEqual(['https://en.wikipedia.org/wiki/Mercury_(planet)']);
    expect(links('(see https://example.com/a)')).toEqual(['https://example.com/a']);
    expect(links('`https://example.com/a` and "https://example.com/b",')).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('keeps the text around links', () => {
    expect(linkify('a https://x.io b').map((p) => p.text).join('')).toBe('a https://x.io b');
  });
});

describe('acceleratorKeys', () => {
  it('names every key the recorder can produce', () => {
    expect(acceleratorKeys('CmdOrCtrl+Plus')).toEqual(['⌘', '+']);
    expect(acceleratorKeys('CmdOrCtrl++')).toEqual(['⌘', '+']);
    expect(acceleratorKeys('CmdOrCtrl+Shift+num7')).toEqual(['⌘', '⇧', 'Num 7']);
    expect(acceleratorKeys('CmdOrCtrl+numadd')).toEqual(['⌘', 'Num +']);
    expect(acceleratorKeys('CmdOrCtrl+PageUp')).toEqual(['⌘', '⇞']);
  });
});

describe('formatWait', () => {
  const ago = (s: number) => formatWait(0, s * 1000);
  it('uses the largest unit that fits', () => {
    expect(ago(40)).toBe('40s');
    expect(ago(12 * 60)).toBe('12m');
    expect(ago(65 * 60)).toBe('1h 05m');
    expect(ago(2 * 86400)).toBe('2d');
    expect(ago(15 * 86400)).toBe('2w');
    expect(ago(35 * 86400)).toBe('1mo');
  });
});
