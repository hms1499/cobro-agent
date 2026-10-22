/** Cobro's mark: an open "C" closing on a coin. Decorative; the wordmark or an aria-label names the app. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M21.5 11.2A7.2 7.2 0 1 0 21.5 20.8"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
      <circle cx="22.6" cy="16" r="2.1" className="fill-tint" />
    </svg>
  );
}
