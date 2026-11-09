// Stroke icons, drawn inline. They take the button's text colour.

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" strokeWidth="1.6" {...stroke} aria-hidden>
      <path d="M9 2.5 4.5 7 9 11.5" />
    </svg>
  );
}

export function ForwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" strokeWidth="1.6" {...stroke} aria-hidden>
      <path d="m5 2.5 4.5 4.5L5 11.5" />
    </svg>
  );
}

/** Drawn at its own pixel size, lines on whole device pixels at 2x, so it stays sharp. */
function Plus({ size }: { size: number }) {
  const c = size / 2 - 0.25;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} strokeWidth="1.5" {...stroke} aria-hidden>
      <path d={`M${c} 3v${size - 6}M3 ${c}h${size - 6}`} />
    </svg>
  );
}

export const NewTaskIcon = () => <Plus size={15} />;
export const NewTabIcon = () => <Plus size={13} />;

/**
 * Two sliders. The tracks sit on whole device pixels on a 2x screen
 * (1 unit = 1 CSS px, 1.5 wide, centred on .25), so they stay sharp.
 */
export function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" strokeWidth="1.5" {...stroke} aria-hidden>
      <path d="M2.25 4.25h5M11.75 4.25h1M2.25 10.75h1M7.75 10.75h5" />
      <circle cx="9.5" cy="4.25" r="1.75" />
      <circle cx="5.5" cy="10.75" r="1.75" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" strokeWidth="1.5" {...stroke} aria-hidden>
      <path d="M3 4.75 6 7.75l3-3" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" strokeWidth="1.4" {...stroke} aria-hidden>
      <path d="m2 2 6 6M8 2 2 8" />
    </svg>
  );
}

export function UpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" strokeWidth="1.5" {...stroke} aria-hidden>
      <path d="M2.5 7.5 6 4l3.5 3.5" />
    </svg>
  );
}

export function DownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" strokeWidth="1.5" {...stroke} aria-hidden>
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}
