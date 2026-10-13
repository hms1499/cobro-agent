import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { PAY_ASSETS } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";
import { liveExecutorDeps } from "@/lib/treasury/live";
import { tokenFiatAmount } from "@/lib/treasury/value";
import { withdrawableAmount } from "@/lib/treasury/withdraw";
import { WithdrawForm } from "./withdraw-form";

export const metadata: Metadata = { title: `${t("withdraw.title")} · ${t("app.name")}` };
/**
 * The withdrawal Server Action can reconcile earlier transactions, drip gas and wait up to 45 s for a
 * receipt; its worst case is near two minutes, so it gets the same 300 s as the wallet lock.
 */
export const maxDuration = 300;

export default function WithdrawPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">{t("withdraw.title")}</h1>
      <p className="max-w-prose text-muted-foreground">{t("withdraw.intro")}</p>
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <Withdraw />
      </Suspense>
    </main>
  );
}

async function Withdraw() {
  const user = await requireUser();
  if (!user.treasuryAddress) return <p role="status">{t("withdraw.notReady")}</p>;
  const [balances, rates] = await Promise.all([
    liveExecutorDeps().chain.readBalances(user.treasuryAddress),
    getReferenceRatesOrNull(),
  ]);
  const options = PAY_ASSETS.filter((asset) => withdrawableAmount(asset, balances) > 0n).map((asset) => {
    const { amount, currency } = tokenFiatAmount(asset, withdrawableAmount(asset, balances));
    return { asset, label: t(`asset.${asset}.name` as const), available: displayAmount(amount, currency, user.localCurrency, rates) };
  });
  if (options.length === 0) return <p className="text-muted-foreground">{t("withdraw.empty")}</p>;
  return <WithdrawForm options={options} destination={user.personalWallet} />;
}
