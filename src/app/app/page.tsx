import { CircleAlert, Clock } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import type { AppUser } from "@/lib/users/queries";
import { finishSetup } from "./actions";

export const metadata: Metadata = { title: `${t("nav.home")} · ${t("app.name")}` };

export default function AppHomePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Suspense fallback={<Skeleton className="h-8 w-48" />}>
        <Home />
      </Suspense>
    </main>
  );
}

async function Home() {
  const user = await requireUser();
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("app.greeting", { name: user.displayName ?? user.email ?? "" })}</h1>
      <SetupBanner status={user.treasuryStatus} />
    </>
  );
}

// Not exported: a page module may only export Next.js page fields.
function SetupBanner({ status }: { status: AppUser["treasuryStatus"] }) {
  if (status === "ready") return null;
  const failed = status === "failed" || status === "missing";
  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className={`flex items-start gap-2 ${failed ? "text-destructive" : "text-warning"}`}>
        {failed ? (
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        ) : (
          <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        )}
        {failed ? t("setup.failed") : t("setup.creating")}
      </p>
      <form action={finishSetup}>
        <SubmitButton pendingLabel={t("setup.working")}>{t("setup.retry")}</SubmitButton>
      </form>
    </section>
  );
}
