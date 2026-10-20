import type { ReactNode } from "react";

/** A screen's title, an optional one-line intro and at most one action (MASTER.md "Shared components"). */
export function PageHeader({ title, intro, action }: { title: string; intro?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {intro && <p className="max-w-prose text-muted-foreground">{intro}</p>}
      </div>
      {action}
    </header>
  );
}
