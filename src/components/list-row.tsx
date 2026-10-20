import Link from "next/link";
import type { ReactNode } from "react";
import type { DisplayAmount } from "@/lib/money/display";

const base = "flex min-h-11 items-start justify-between gap-4 rounded-lg px-3 py-2.5";

/**
 * One invoice or one agent action in a list (MASTER.md "Shared components"). A row with `href` is a
 * link with the hover tint and a focus ring; without it the row is static. The title truncates and
 * the amount never wraps, so long client names and large figures fit at 375px.
 */
export function ListRow({
  href,
  title,
  subtitle,
  amount,
  status,
  icon,
}: {
  href?: string;
  title: string;
  subtitle?: string;
  amount?: DisplayAmount;
  status?: ReactNode;
  icon?: ReactNode;
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-start gap-3">
        {icon}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{title}</span>
          {subtitle && <span className="truncate text-sm text-muted-foreground">{subtitle}</span>}
        </span>
      </span>
      {(amount || status) && (
        <span className="flex shrink-0 flex-col items-end gap-1 text-right tabular-nums">
          {amount && <span className="whitespace-nowrap font-semibold">{amount.primary}</span>}
          {amount?.secondary && <span className="whitespace-nowrap text-sm text-muted-foreground">{amount.secondary}</span>}
          {status}
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
