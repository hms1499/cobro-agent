/**
 * Small line illustrations for empty states (spec 4f §4.2). Drawn in token colours only; decorative,
 * because the empty state's title says what is missing.
 */
const frame = "h-24 w-24 shrink-0";

export function InvoicesIllustration() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className={frame}>
      <circle cx="48" cy="48" r="44" className="fill-tint/25" />
      <rect x="30" y="22" width="36" height="48" rx="5" className="fill-card stroke-secondary-accent" strokeWidth="2" />
      <path d="M38 34h20M38 42h20M38 50h12" strokeWidth="2.5" strokeLinecap="round" className="stroke-tint" />
      <circle cx="64" cy="64" r="11" className="fill-primary" />
      <path d="M60 64.5l3 3 5.5-6" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary-foreground" />
    </svg>
  );
}

export function ActivityIllustration() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className={frame}>
      <circle cx="48" cy="48" r="44" className="fill-tint/25" />
      <rect x="20" y="28" width="56" height="40" rx="6" className="fill-card stroke-secondary-accent" strokeWidth="2" />
      <path d="M26 54l10-10 8 6 10-12 10 8 6-4" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary" />
      <circle cx="70" cy="42" r="3" className="fill-highlight stroke-primary" strokeWidth="1.5" />
    </svg>
  );
}

export function AddressesIllustration() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className={frame}>
      <circle cx="48" cy="48" r="44" className="fill-tint/25" />
      <rect x="22" y="30" width="52" height="36" rx="6" className="fill-card stroke-secondary-accent" strokeWidth="2" />
      <path d="M30 42h22M30 50h14" strokeWidth="2.5" strokeLinecap="round" className="stroke-tint" />
      <path d="M64 38c-5 0-8 3.6-8 7.6 0 5.4 8 12.4 8 12.4s8-7 8-12.4c0-4-3-7.6-8-7.6z" className="fill-primary" />
      <circle cx="64" cy="45.6" r="2.6" className="fill-primary-foreground" />
    </svg>
  );
}
