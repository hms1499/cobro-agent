import { CountUp } from "@/components/count-up";
import type { DisplayAmount } from "@/lib/money/display";

/** The lead figure large, the second one small and muted (MASTER.md "Money formatting"). */
const SIZES = {
  md: "text-base font-semibold",
  lg: "text-3xl font-semibold tracking-tight",
  xl: "text-[2rem] leading-tight font-semibold tracking-tight md:text-[2.125rem]",
} as const;

export function Money({ amount, size = "md", countUp = false }: { amount: DisplayAmount; size?: keyof typeof SIZES; countUp?: boolean }) {
  return (
    <span className="flex flex-col tabular-nums">
      <span className={SIZES[size]}>
        {countUp ? <CountUp value={amount.primary} /> : amount.primary}
      </span>
      {amount.secondary && <span className="text-sm text-muted-foreground">{amount.secondary}</span>}
    </span>
  );
}
