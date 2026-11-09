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

function Plus({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" strokeWidth="1.6" {...stroke} aria-hidden>
      <path d="M7 2.5v9M2.5 7h9" />
    </svg>
  );
}

export const NewTaskIcon = () => <Plus size={15} />;
export const NewTabIcon = () => <Plus size={13} />;

/** An eight-tooth gear. */
export function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" strokeWidth="1.3" {...stroke} aria-hidden>
      <path d="M6.76 2.85 7.01 1.07h1.98l.25 1.78 1.53.63 1.43-1.08 1.4 1.4-1.08 1.43.63 1.53 1.78.25v1.98l-1.78.25-.63 1.53 1.08 1.43-1.4 1.4-1.43-1.08-1.53.63-.25 1.78H7.01l-.25-1.78-1.53-.63-1.43 1.08-1.4-1.4 1.08-1.43-.63-1.53-1.78-.25V7.01l1.78-.25.63-1.53L2.4 3.8l1.4-1.4 1.43 1.08z" />
      <circle cx="8" cy="8" r="2.1" />
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
