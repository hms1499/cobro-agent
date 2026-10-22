import Link from "next/link";
import type { ReactNode } from "react";
import type { DisplayAmount } from "@/lib/money/display";

const base = "flex min-h-11 items-start justify-between gap-4 rounded-lg px-3 py-2.5";

/**
 * One invoice or one agent action in a list (MASTER.md "Shared components"). A row with `href` is a
 * link with the hover tint and a focus ring; without it the row is static. The title truncates (or,
 * with `wrapTitle`, wraps to two lines for sentences such as agent actions) and the amount never
 * wraps, so long client names and large figures fit at 375px.
 */
export function ListRow({
  href,
  title,
  subtitle,
  amount,
  status,
  icon,
  leading,
  wrapTitle = false,
}: {
  href?: string;
  title: string;
  subtitle?: string;
  amount?: DisplayAmount;
  status?: ReactNode;
  icon?: ReactNode;
  /** A larger leading element, such as a client's initials. */
  leading?: ReactNode;
  wrapTitle?: boolean;
}) {
  const body = (
    <>
      <span className={`flex min-w-0 gap-3 ${leading ? "items-center" : "items-start"}`}>
        {leading ?? icon}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className={`font-medium ${wrapTitle ? "line-clamp-2" : "truncate"}`}>{title}</span>
            {status && <span className="shrink-0">{status}</span>}
          </span>
          {subtitle && <span className="truncate text-sm text-muted-foreground">{subtitle}</span>}
        </span>
      </span>
      {amount && (
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
          <span className="whitespace-nowrap font-semibold">{amount.primary}</span>
          {amount.secondary && <span className="whitespace-nowrap text-sm text-muted-foreground">{amount.secondary}</span>}
        </span>
      )}
    </>
  );
  if (!href) return <div className={base}>{body}</div>;
  return (
    <Link
      href={href}
      className={`${base} hover-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
    >
      {body}
    </Link>
  );
}
