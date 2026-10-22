import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { listSavedAddresses } from "@/lib/addresses/repo";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { readDisplayBalances } from "@/lib/treasury/live";
import { withdrawDestinations, withdrawOptions } from "./options";
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
      <PageHeader title={t("withdraw.title")} intro={t("withdraw.intro")} />
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <Withdraw />
      </Suspense>
    </main>
  );
}

async function Withdraw() {
  const user = await requireUser();
  if (!user.treasuryAddress) return <p role="status">{t("withdraw.notReady")}</p>;
  const [balances, rates, saved] = await Promise.all([
    readDisplayBalances(user.treasuryAddress),
    getReferenceRatesOrNull(),
    listSavedAddresses(getDb(), user.id),
  ]);
  const options = withdrawOptions(balances, user.localCurrency, rates);
  if (options.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<Wallet aria-hidden="true" className="size-6 text-secondary-accent" />}
            title={t("withdraw.emptyTitle")}
            body={t("withdraw.empty")}
          />
        </CardContent>
      </Card>
    );
  }
  const destinations = withdrawDestinations(user.personalWallet, saved, new Date());
  // No usable destination (no Cobro wallet known yet and every saved address still waiting): a plain note with the
  // way out, instead of a form that could only end in an error.
  if (!destinations.some((d) => d.usableInHours === null)) {
    return (
      <div className="flex flex-col gap-2">
        <p role="status">{t("withdraw.noDestination")}</p>
        <Link href="/app/settings/addresses" className="inline-flex min-h-11 w-fit items-center text-primary underline underline-offset-4">
          {t("withdraw.addAddress")}
        </Link>
      </div>
    );
  }
  return (
    <Card>
      <CardContent>
        <WithdrawForm options={options} destinations={destinations} />
      </CardContent>
    </Card>
  );
}
