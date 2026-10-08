import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: `${t("onboarding.title")} · ${t("app.name")}` };

export default function OnboardingPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">{t("onboarding.step", { step: 2, total: 3 })}</p>
        <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden="true">
          <div className="h-full w-2/3 rounded-full bg-primary" />
        </div>
      </div>
      <h1 className="text-2xl font-semibold">{t("onboarding.title")}</h1>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Onboarding />
      </Suspense>
    </main>
  );
}

async function Onboarding() {
  const user = await requireUser({ allowOnboarding: true });
  if (user.localCurrency) redirect("/app");
  return <OnboardingForm defaultName={user.displayName ?? ""} />;
}
