import { ArrowLeft } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingRows } from "@/components/loading-rows";
import { PageHeader } from "@/components/page-header";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { ActivityFeed } from "../../activity-feed";

export const metadata: Metadata = { title: `${t("activity.historyTitle")} · ${t("app.name")}` };

export default function HistoryPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Link
        href="/app/rules"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("rules.back")}
      </Link>
      <PageHeader title={t("activity.historyTitle")} intro={t("activity.historyIntro")} />
      <Suspense fallback={<LoadingRows count={8} />}>
        <History />
      </Suspense>
    </main>
  );
}

async function History() {
  const user = await requireUser();
  return <ActivityFeed user={user} limit={40} />;
}
