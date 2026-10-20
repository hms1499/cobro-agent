import { CircleAlert, Clock } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingRows } from "@/components/loading-rows";
import { SubmitButton } from "@/components/submit-button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { requireUser } from "@/lib/auth/current-user";
import { getOpenProposal } from "@/lib/treasury/request-reads";
import type { AppUser } from "@/lib/users/queries";
import { finishSetup } from "./actions";
import { AgentLine } from "./agent-line";
import { ProposalBanner } from "./proposal-banner";
import { ProposalSlot } from "./proposal-slot";
import { Recent } from "./recent";
import { RefreshWhileCreating } from "./refresh-while-creating";
import { MoneyCard } from "./treasury-summary";

export const metadata: Metadata = { title: `${t("nav.home")} · ${t("app.name")}` };

/**
 * Approving a proposal runs the agent in after(): it may reconcile, drip gas, request a quote and wait
 * for receipts, like the withdrawal action, so it gets the same 300 s as the wallet lock.
 */
export const maxDuration = 300;

export default function AppHomePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <Suspense fallback={<HomeSkeleton />}>
        <Home />
      </Suspense>
    </main>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("common.loading")}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full lg:w-[330px]" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

/** Spec §4.2, layout A: money first, one agent line, then Recent; two columns from 1024px (A2). */
async function Home() {
  const user = await requireUser();
  const proposal = await getOpenProposal(user.id);
  // One primary action per screen: a setup or approval banner takes it from "New invoice" (MASTER.md "Buttons").
  const primaryAction = user.treasuryStatus === "ready" && !proposal;
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("app.greeting", { name: user.displayName ?? user.email ?? "" })}</h1>
      <SetupBanner status={user.treasuryStatus} />
      <ProposalSlot>
        {proposal && (
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <ProposalBanner user={user} proposal={proposal} />
          </Suspense>
        )}
      </ProposalSlot>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[330px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <MoneyCard user={user} primaryAction={primaryAction} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-11 w-full" />}>
            <AgentLine user={user} />
          </Suspense>
        </div>
        <Suspense fallback={<LoadingRows count={5} />}>
          <Recent user={user} />
        </Suspense>
      </div>
    </>
  );
}

// Not exported: a page module may only export Next.js page fields.
function SetupBanner({ status }: { status: AppUser["treasuryStatus"] }) {
  if (status === "ready") return null;
  // "missing" is the moment between sign-in and the background wallet setup claiming its row.
  const failed = status === "failed";
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
      {!failed && <RefreshWhileCreating />}
      <form action={finishSetup}>
        <SubmitButton pendingLabel={t("setup.working")}>{t("setup.retry")}</SubmitButton>
      </form>
    </section>
  );
}
