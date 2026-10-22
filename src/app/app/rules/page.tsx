import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingRows } from "@/components/loading-rows";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import type { RulesRow } from "@/lib/db/schema";
import { getReferenceRates } from "@/lib/fx/rates";
import { modeNeedsApproval } from "@/lib/treasury/approvals";
import { decide } from "@/lib/treasury/engine";
import { engineInput } from "@/lib/treasury/executor";
import { describeDecision } from "@/lib/treasury/explain";
import { readDisplayBalances } from "@/lib/treasury/live";
import { getOpenProposal, getRulesRow } from "@/lib/treasury/request-reads";
import { rulesFormValues } from "@/lib/treasury/rules-form";
import type { AppUser } from "@/lib/users/queries";
import { ActivityFeed } from "../activity-feed";
import { AgentStatus } from "../agent-status";
import { ProtectedCard } from "../treasury-summary";
import { RulesForm } from "./rules-form";

export const metadata: Metadata = { title: `${t("rules.title")} · ${t("app.name")}` };

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
  const proposal = await getOpenProposal(user.id);
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
      {/* Spec 4f: status and results beside the rules on desktop; on mobile status comes first. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-8">
          <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
            <AgentStatus user={user} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-32 w-full rounded-xl" />}>
            <ProtectedCard user={user} />
          </Suspense>
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
          <Card>
            <CardContent>
              <section aria-labelledby="rules-heading" className="flex flex-col gap-4">
                <h2 id="rules-heading" className="text-lg font-semibold">
                  {row.localCurrency === "USD" ? t("rules.usdTitle") : t("rules.formTitle")}
                </h2>
                <Suspense fallback={<Skeleton className="h-16 w-full" />}>
                  <Preview user={user} row={row} />
                </Suspense>
                {row.localCurrency === "USD" ? (
                  <>
                    <p className="max-w-prose text-muted-foreground">{t("rules.usdExplain")}</p>
                    <Link
                      href="/app/settings"
                      className="inline-flex min-h-11 w-fit items-center text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {t("rules.usdSettings")}
                    </Link>
                  </>
                ) : (
                  <RulesForm currency={row.localCurrency} values={rulesFormValues(row)} />
                )}
              </section>
            </CardContent>
          </Card>
          <Suspense fallback={<LoadingRows count={5} />}>
            <ActivityFeed user={user} />
          </Suspense>
        </div>
      </div>
    </>
  );
}

/** "If the agent ran now, it would…": the engine on live balances. It sends no RFQ and signs nothing. */
async function Preview({ user, row }: { user: AppUser; row: RulesRow }) {
  if (!user.treasuryAddress) return null;
  let text: string;
  try {
    const [balances, rates] = await Promise.all([readDisplayBalances(user.treasuryAddress), getReferenceRates()]);
    const input = await engineInput(getDb(), { userId: user.id, rules: row }, balances, rates, new Date());
    const decision = decide(input);
    // A dollars freelancer's agent never asks (USD home spec §2.3), whatever mode is stored.
    const askFirst = decision.kind === "convert" && row.localCurrency !== "USD" && modeNeedsApproval(row.approvalMode, decision.reason);
    text = describeDecision(decision, { local: row.localCurrency, rates }, { askFirst });
  } catch (error) {
    console.error("Rules preview failed:", error instanceof Error ? error.message : error);
    return <p className="text-muted-foreground">{t("rules.previewUnavailable")}</p>;
  }
  return (
    <p role="status" className="rounded-xl bg-muted p-4">
      <span className="font-medium">{t("rules.preview")}</span> {text}
    </p>
  );
}
