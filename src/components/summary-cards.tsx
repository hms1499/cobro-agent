import { CircleAlert } from "lucide-react";
import { CountUp } from "@/components/count-up";
import { t } from "@/i18n";
import type { ReferenceRates } from "@/lib/fx/rates";
import type { InvoiceSummary, SummaryFigure } from "@/lib/invoices/view";
import type { LocalCurrency } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";

function countLabel(count: number): string {
  return count === 1 ? t("summary.countOne") : t("summary.count", { count });
}

function Cell({
  label,
  figure,
  local,
  rates,
  alert = false,
}: {
  label: string;
  figure: SummaryFigure;
  local: LocalCurrency | null;
  rates: ReferenceRates | null;
  alert?: boolean;
}) {
  const amount = figure.usd === null ? null : displayAmount(figure.usd, "USD", local, rates);
  const warn = alert && figure.count > 0;
  return (
    <div className="flex flex-col gap-1 px-5 py-4 first:pt-5 last:pb-5 sm:py-5">
      <dt className="flex items-center justify-between gap-3 text-sm">
        <span className={`flex items-center gap-1.5 ${warn ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          {warn && <CircleAlert aria-hidden="true" className="size-4" />}
          {label}
        </span>
        {amount && <span className="text-muted-foreground tabular-nums">{countLabel(figure.count)}</span>}
      </dt>
      <dd className="flex flex-col tabular-nums">
        <span className={`text-2xl font-semibold tracking-tight ${warn ? "text-destructive" : ""}`}>
          {amount ? <CountUp value={amount.primary} /> : countLabel(figure.count)}
        </span>
        <span className="text-sm text-muted-foreground">{amount ? amount.secondary : t("summary.noRates")}</span>
      </dd>
    </div>
  );
}

/**
 * Open, overdue and received this month (spec 4f, item A): one strip split by hairlines, Mercury's
 * "what's owed at a glance", rather than three loose cards.
 */
export function SummaryCards({
  summary,
  local,
  rates,
}: {
  summary: InvoiceSummary;
  local: LocalCurrency | null;
  rates: ReferenceRates | null;
}) {
  return (
    <dl
      aria-label={t("summary.label")}
      className="grid divide-y divide-border rounded-xl bg-card shadow-sm ring-1 ring-foreground/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      <Cell label={t("summary.open")} figure={summary.open} local={local} rates={rates} />
      <Cell label={t("summary.overdue")} figure={summary.overdue} local={local} rates={rates} alert />
      <Cell label={t("summary.received")} figure={summary.receivedThisMonth} local={local} rates={rates} />
    </dl>
  );
}
