import type { ReactNode } from "react";

/**
 * An empty list says what to do next (MASTER.md "Shared components"). With an illustration the block
 * is centred, as the only thing in its card.
 */
export function EmptyState({
  icon,
  illustration,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  illustration?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-3 px-3 py-6 ${illustration ? "items-center py-10 text-center" : "items-start"}`}>
      {illustration ?? icon}
      <p className="font-semibold">{title}</p>
      <p className="max-w-prose text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
