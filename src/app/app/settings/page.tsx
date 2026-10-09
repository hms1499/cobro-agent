import type { Metadata } from "next";
import { Suspense } from "react";
import { ParaProviders } from "@/components/providers/para-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { readPublicEnv } from "@/lib/config/public";
import { SignOutButton } from "./sign-out";

export const metadata: Metadata = { title: `${t("settings.title")} · ${t("app.name")}` };

export default function SettingsPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <Settings />
      </Suspense>
    </main>
  );
}

async function Settings() {
  const user = await requireUser({ allowOnboarding: true });
  const env = readPublicEnv();
  const rows = [
    { label: t("settings.email"), value: user.email ?? t("settings.notSet") },
    { label: t("settings.name"), value: user.displayName ?? t("settings.notSet") },
    { label: t("settings.currency"), value: user.localCurrency ? t(`currency.${user.localCurrency}` as const) : t("settings.notSet") },
  ];
  return (
    <>
      <Card>
        <CardContent>
          <dl className="flex flex-col gap-4">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                <dd className="font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {env.NEXT_PUBLIC_PARA_API_KEY && (
        <ParaProviders apiKey={env.NEXT_PUBLIC_PARA_API_KEY} environment={env.NEXT_PUBLIC_PARA_ENVIRONMENT}>
          <SignOutButton />
        </ParaProviders>
      )}
    </>
  );
}
