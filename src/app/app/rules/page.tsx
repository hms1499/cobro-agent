import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingRows } from "@/components/loading-rows";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { activeChatCardId } from "@/lib/treasury/chat-swap";
import { getOpenProposal, getRulesRow } from "@/lib/treasury/request-reads";
import { ActivityFeed } from "../activity-feed";
import { AgentStatus } from "../agent-status";
import { ProtectedCard } from "../treasury-summary";
import { RulesSummary } from "./rules-summary";
import { SwapAssistant } from "./swap-assistant";

export const metadata: Metadata = { title: `${t("rules.title")} · ${t("app.name")}` };
/**
 * The chat swap runs in after() once the tap answers (spec §5), and after() is cut off at the function's duration.
 * Its worst case is an RFQ of 75 s plus three receipts of 45 s, so it gets the same 300 s as /app/withdraw. Only this
 * page hosts the action; /app/rules/edit and /app/rules/history start no swap.
 */
export const maxDuration = 300;

export default function RulesPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <PageHeader title={t("rules.title")} intro={t("rules.intro")} />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Rules />
      </Suspense>
    </main>
  );
}

async function Rules() {
  const user = await requireUser();
  const row = await getRulesRow(user.id);
  if (!row) redirect("/app/onboarding");
  const [proposal, activeCardId] = await Promise.all([getOpenProposal(user.id), activeChatCardId(getDb(), user.id)]);
  return (
    <>
      {proposal && (
        <p role="status" className="rounded-xl bg-highlight p-4">
          {t("rules.proposalWaiting")}{" "}
          <Link
            href="/app"
            className="font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t("rules.proposalReview")}
          </Link>
        </p>
      )}
      {/*
        Spec §6, layout B. DOM order is the order below lg: status, chat, then rules and history. From lg the chat
        takes the left column over both rows and the right column holds status, then rules and history.
      */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="lg:col-start-2 lg:row-start-1">
          <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
            <AgentStatus user={user} />
          </Suspense>
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <SwapAssistant activeCardId={activeCardId} paused={!row.enabled} />
        </div>
        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-2">
          <RulesSummary row={row} />
          <Suspense fallback={<Skeleton className="h-32 w-full rounded-xl" />}>
            <ProtectedCard user={user} />
          </Suspense>
          <Suspense fallback={<LoadingRows count={5} />}>
            <ActivityFeed user={user} limit={5} viewAll />
          </Suspense>
        </div>
      </div>
    </>
  );
}
