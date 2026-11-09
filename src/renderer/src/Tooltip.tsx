import { useEffect, useState } from 'react';

interface Tip {
  text: string;
  left: number;
  /** Under the element, or (near the bottom of the window) above it. */
  top?: number;
  bottom?: number;
  maxWidth: number;
}

/**
 * The raised tooltip for text that is cut off. Hovering an element with
 * `data-tip` shows that text under it, but only when the element (or the
 * child `data-tip-measure` selects) is actually truncated. `data-tip-width`
 * caps its width. One instance serves the whole window.
 */
export function TruncationTooltip() {
  const [tip, setTip] = useState<Tip>();

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
        const box = el.getBoundingClientRect();
        const below = box.bottom + 80 < window.innerHeight;
        setTip({
          text: el.getAttribute('data-tip') ?? '',
          left,
          ...(below ? { top: box.bottom + 4 } : { bottom: window.innerHeight - box.top + 4 }),
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
    <div className="tooltip" role="tooltip" style={{ left: tip.left, top: tip.top, bottom: tip.bottom, maxWidth: tip.maxWidth }}>
      {tip.text}
    </div>
  );
}
