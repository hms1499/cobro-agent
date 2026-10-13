// src/app/app/conversions.tsx
import { ExternalLink } from "lucide-react";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDateTime } from "@/lib/invoices/dates";
import { moneyText, percentText } from "@/lib/treasury/explain";
import { recentConversions, volumeStats } from "@/lib/treasury/stats";
import type { AppUser } from "@/lib/users/queries";

/** Spec §10.5: each conversion with its price against the market rate, and the RFQ volume. */
export async function Conversions({ user }: { user: AppUser }) {
  const db = getDb();
  const [trades, volume, rates] = await Promise.all([recentConversions(db, user.id), volumeStats(db, user.id), getReferenceRatesOrNull()]);
  const ctx = { local: user.localCurrency, rates };
  return (
    <section aria-labelledby="conversions-heading" className="flex flex-col gap-3">
      <h2 id="conversions-heading" className="text-lg font-semibold">
        {t("conversions.title")}
      </h2>
      {trades.length === 0 ? (
        <p className="text-muted-foreground">{t("conversions.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {trades.map((trade) => (
            <li key={trade.id} className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
              <p className="font-medium tabular-nums">
                {t("conversions.row", {
                  from: moneyText(trade.sellAsset, trade.sellAmount, ctx),
                  to: moneyText(trade.buyAsset, trade.buyAmount, ctx),
                })}
              </p>
              {trade.filledAt && <p className="text-sm text-muted-foreground">{formatDateTime(trade.filledAt)}</p>}
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("common.details")}</summary>
                <p>
                  {(trade.slippageBps ?? 0) > 0
                    ? t("event.price.worse", { pct: percentText(trade.slippageBps) })
                    : t("event.price.better")}
                </p>
                {trade.swapTxHash && (
                  <a
                    href={`https://celoscan.io/tx/${trade.swapTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4"
                  >
                    {t("activity.viewTx")}
                    <ExternalLink aria-hidden="true" className="size-4" />
                  </a>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
      {volume.requested > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("conversions.volume", { filled: volume.filled, requested: volume.requested })}
        </p>
      )}
    </section>
  );
}
