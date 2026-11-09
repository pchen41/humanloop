import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Tip {
  text: string;
  left: number;
  /** The hovered element's top and bottom edges. */
  hostTop: number;
  hostBottom: number;
  maxWidth: number;
  /** Placed above the element: there wasn't room for it below. */
  above?: boolean;
}

/**
 * The raised tooltip for text that is cut off. Hovering an element with
 * `data-tip` shows that text under it, but only when the element (or the
 * child `data-tip-measure` selects) is actually truncated. `data-tip-width`
 * caps its width. One instance serves the whole window.
 */
export function TruncationTooltip() {
  const [tip, setTip] = useState<Tip>();
  const box = useRef<HTMLDivElement>(null);

  // Shown under the element unless that runs off the bottom of the window.
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (tip && !tip.above && r && r.bottom > window.innerHeight - 4) setTip({ ...tip, above: true });
  }, [tip]);

  useEffect(() => {
    let timer = 0;
    let host: Element | null = null;
    const hide = () => {
      clearTimeout(timer);
      host = null;
      setTip(undefined);
    };
    const over = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
      if (el === host) return;
      hide();
      if (!el) return;
      host = el;
      timer = window.setTimeout(() => {
        const selector = el.getAttribute('data-tip-measure');
        const measured = selector ? el.querySelector(selector) : el;
        if (!(measured instanceof HTMLElement) || measured.scrollWidth <= measured.clientWidth) return;
        const text = measured.getBoundingClientRect();
        // Line the tooltip's text up with the cut-off text (its padding is 8px plus a 1px border).
        const left = Math.max(4, text.left - 9);
        const host = el.getBoundingClientRect();
        setTip({
          text: el.getAttribute('data-tip') ?? '',
          left,
          hostTop: host.top,
          hostBottom: host.bottom,
          maxWidth: Math.min(Number(el.getAttribute('data-tip-width')) || 400, window.innerWidth - left - 12),
        });
      }, 500);
    };
    const out = (e: MouseEvent) => {
      if (!e.relatedTarget) hide(); // left the window
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    for (const type of ['mousedown', 'keydown', 'wheel', 'scroll'] as const) window.addEventListener(type, hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      for (const type of ['mousedown', 'keydown', 'wheel', 'scroll'] as const) window.removeEventListener(type, hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      ref={box}
      className="tooltip"
      role="tooltip"
      style={{
        left: tip.left,
        maxWidth: tip.maxWidth,
        ...(tip.above ? { bottom: window.innerHeight - tip.hostTop + 4 } : { top: tip.hostBottom + 4 }),
      }}
    >
      {tip.text}
    </div>
  );
}
