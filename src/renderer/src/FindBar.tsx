import { useEffect, useRef, useState } from 'react';
import { terminals } from './terminals';

interface Props {
  tabId: string;
  query: string;
  onQuery(query: string): void;
  onClose(): void;
  /** Bumped each time ⌘F is pressed, to refocus and select the field. */
  focusSignal: number;
}

/** Find in the active terminal's scrollback (⌘F). Return finds the next match, Shift+Return the previous. */
export function FindBar({ tabId, query, onQuery, onClose, focusSignal }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{ index: number; count: number }>();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusSignal]);

  // Search the tab that's showing; clear its highlights when it stops showing or the bar closes.
  useEffect(() => {
    const h = terminals.peek(tabId);
    if (!h) return;
    const off = h.onFindResults((index, count) => setResult({ index, count }));
    setResult(undefined);
    h.find(query, 'next', true);
    return () => {
      off();
      h.clearFind();
    };
    // Re-run on tab change only; typing searches incrementally below.
  }, [tabId]);

  const search = (q: string, direction: 'next' | 'previous', incremental = false) => {
    const found = terminals.peek(tabId)?.find(q, direction, incremental);
    if (!q) setResult(undefined);
    else if (!found) setResult({ index: -1, count: 0 });
  };

  const status = !query || !result ? '' : result.count === 0 ? 'No results' : result.index >= 0 ? `${result.index + 1} of ${result.count}` : `${result.count} found`;

  return (
    <div className="find-bar" role="search">
      <input
        ref={input}
        value={query}
        placeholder="Find"
        spellCheck={false}
        onChange={(e) => {
          onQuery(e.target.value);
          search(e.target.value, 'next', true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            search(query, e.shiftKey ? 'previous' : 'next');
          }
        }}
      />
      <span className="find-status">{status}</span>
      <button type="button" className="ghost" title="Previous (⇧⌘G)" onClick={() => search(query, 'previous')}>
        ‹
      </button>
      <button type="button" className="ghost" title="Next (⌘G)" onClick={() => search(query, 'next')}>
        ›
      </button>
      <button type="button" className="ghost" title="Close (Esc)" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
