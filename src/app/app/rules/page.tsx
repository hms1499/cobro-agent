import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { rules, type RulesRow } from "@/lib/db/schema";
import { getReferenceRates } from "@/lib/fx/rates";
import { modeNeedsApproval } from "@/lib/treasury/approvals";
import { decide } from "@/lib/treasury/engine";
import { engineInput } from "@/lib/treasury/executor";
import { describeDecision } from "@/lib/treasury/explain";
import { readDisplayBalances } from "@/lib/treasury/live";
import { openProposal } from "@/lib/treasury/repo";
import { rulesFormValues } from "@/lib/treasury/rules-form";
import type { AppUser } from "@/lib/users/queries";
import { RulesForm } from "./rules-form";

export const metadata: Metadata = { title: `${t("rules.title")} · ${t("app.name")}` };

export default function RulesPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">{t("rules.title")}</h1>
      <p className="max-w-prose text-muted-foreground">{t("rules.intro")}</p>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Rules />
      </Suspense>
    </main>
  );
}

async function Rules() {
  const user = await requireUser();
  const [row] = await getDb().select().from(rules).where(eq(rules.userId, user.id));
  if (!row) redirect("/app/onboarding");
  const proposal = await openProposal(getDb(), user.id);
  return (
    <>
      {proposal && (
        <p role="status" className="rounded-xl bg-muted p-4">
          {t("rules.proposalWaiting")}{" "}
          <Link
            href="/app"
            className="font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t("rules.proposalReview")}
          </Link>
        </p>
      )}
      <Suspense fallback={<Skeleton className="h-16 w-full" />}>
        <Preview user={user} row={row} />
      </Suspense>
      <RulesForm currency={row.localCurrency} values={rulesFormValues(row)} />
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
    const askFirst = decision.kind === "convert" && modeNeedsApproval(row.approvalMode, decision.reason);
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
