import type { ReactNode } from "react";

/** An empty list says what to do next (MASTER.md "Shared components"). */
export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-3 py-6">
      {icon}
      <p className="font-semibold">{title}</p>
      <p className="max-w-prose text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
