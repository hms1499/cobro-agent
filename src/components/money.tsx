import type { DisplayAmount } from "@/lib/money/display";

/** Local currency large, the second currency small and muted (MASTER.md "Money formatting"). */
export function Money({ amount, size = "md" }: { amount: DisplayAmount; size?: "md" | "lg" }) {
  return (
    <span className="flex flex-col tabular-nums">
      <span className={size === "lg" ? "text-3xl font-semibold tracking-tight" : "text-base font-semibold"}>
        {amount.primary}
      </span>
      {amount.secondary && <span className="text-sm text-muted-foreground">{amount.secondary}</span>}
    </span>
  );
}
