import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/i18n";
import type { RulesRow } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money/format";

/** The rules in two lines (spec §6) with the way to the full form. A dollars freelancer has no reserve to show. */
export function RulesSummary({ row }: { row: RulesRow }) {
  const usd = row.localCurrency === "USD";
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{usd ? t("rules.usdTitle") : t("rules.summaryTitle")}</h2>
        {usd ? (
          <p className="text-muted-foreground">{t("rules.usdExplain")}</p>
        ) : (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
            <dt className="text-muted-foreground">{t("rules.summaryReserve")}</dt>
            <dd className="text-right font-medium">{formatMoney(row.reserveAmount, row.localCurrency)}</dd>
            <dt className="text-muted-foreground">{t("rules.summaryDaily")}</dt>
            <dd className="text-right font-medium">{formatMoney(String(row.dailyMaxUsd), "USD")}</dd>
          </dl>
        )}
        {usd ? (
          <Link
            href="/app/settings"
            className="inline-flex min-h-11 w-fit items-center text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t("rules.usdSettings")}
          </Link>
        ) : (
          <Link
            href="/app/rules/edit"
            className="inline-flex min-h-11 w-fit items-center rounded-lg border border-secondary-accent bg-card px-4 font-medium text-primary hover:bg-primary/6 active:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t("rules.edit")}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
