import { AddressBook } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { InitialAvatar } from "@/components/initial-avatar";
import { PageHeader } from "@/components/page-header";
import { ParaProviders } from "@/components/providers/para-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { listSavedAddresses } from "@/lib/addresses/repo";
import { requireUser } from "@/lib/auth/current-user";
import { readPublicEnv } from "@/lib/config/public";
import { CHECK_INTERVAL_MINUTES } from "@/lib/cron/schedule";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { HOME_CURRENCIES, type HomeCurrency } from "@/lib/money/currencies";
import { readDisplayBalances } from "@/lib/treasury/live";
import { getRulesRow } from "@/lib/treasury/request-reads";
import { switchConsequences, type SwitchConsequences } from "@/lib/users/home-currency";
import type { AppUser } from "@/lib/users/queries";
import { CurrencyForm } from "./currency-form";
import { MyWalletButton } from "./my-wallet";
import { SignOutButton } from "./sign-out";

export const metadata: Metadata = { title: `${t("settings.title")} · ${t("app.name")}` };

export default function SettingsPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <PageHeader title={t("settings.title")} />
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <Settings />
      </Suspense>
    </main>
  );
}

async function Settings() {
  const user = await requireUser({ allowOnboarding: true });
  const env = readPublicEnv();
  const savedCount = (await listSavedAddresses(getDb(), user.id)).length;
  const rows = [
    { label: t("settings.email"), value: user.email ?? t("settings.notSet") },
    { label: t("settings.name"), value: user.displayName ?? t("settings.notSet") },
  ];
  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <InitialAvatar name={user.displayName ?? user.email ?? "?"} size="md" />
            <h2 className="text-lg font-semibold">{t("settings.profile")}</h2>
          </div>
          <dl className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:justify-between sm:gap-6">
                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 break-words font-medium sm:text-right">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {user.localCurrency && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">{t("settings.currencyTitle")}</h2>
              <p className="max-w-prose text-sm text-muted-foreground">{t("settings.currencyIntro")}</p>
            </div>
            <Suspense fallback={<Skeleton className="h-40 w-full" />}>
              <Currency user={user} current={user.localCurrency} />
            </Suspense>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <AddressBook aria-hidden="true" className="size-5 text-secondary-accent" />
            {t("settings.addresses.title")}
          </h2>
          <p className="text-muted-foreground">{t("settings.addresses.count", { count: savedCount })}</p>
          <Link
            href="/app/settings/addresses"
            className="inline-flex min-h-11 w-fit items-center text-primary underline underline-offset-4"
          >
            {t("settings.addresses.manage")}
          </Link>
        </CardContent>
      </Card>
      {env.NEXT_PUBLIC_PARA_API_KEY && (
        // Para renders its children only once the SDK has loaded (several seconds on a slow link); until a
        // button exists, the placeholder holds their place so the screen doesn't look unfinished.
        <div className="flex flex-col gap-6 [&:not(:has(button))_.para-placeholder]:flex">
          <ParaProviders apiKey={env.NEXT_PUBLIC_PARA_API_KEY} environment={env.NEXT_PUBLIC_PARA_ENVIRONMENT}>
            <MyWalletButton email={user.email} />
            <SignOutButton />
          </ParaProviders>
          <div className="para-placeholder hidden flex-col gap-3" aria-busy="true" aria-label={t("common.loading")}>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-full max-w-prose" />
            <Skeleton className="h-11 w-40" />
            <Skeleton className="h-11 w-28" />
          </div>
        </div>
      )}
    </>
  );
}

/** The currency form with what each switch would convert, from live balances (USD home currency spec §4.3). */
async function Currency({ user, current }: { user: AppUser; current: HomeCurrency }) {
  const [row, rates, balances] = await Promise.all([
    getRulesRow(user.id),
    getReferenceRatesOrNull(),
    user.treasuryAddress ? readDisplayBalances(user.treasuryAddress).catch(() => null) : null,
  ]);
  const none: SwitchConsequences = { converts: [] };
  const consequences = Object.fromEntries(
    HOME_CURRENCIES.map((code) => [code, balances ? switchConsequences(code, balances, rates) : none]),
  ) as Record<HomeCurrency, SwitchConsequences>;
  return <CurrencyForm current={current} reserve={row?.reserveAmount ?? "0"} consequences={consequences} minutes={CHECK_INTERVAL_MINUTES} />;
}
