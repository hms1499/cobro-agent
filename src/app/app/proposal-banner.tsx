import { Hand } from "@phosphor-icons/react/ssr";
import { t } from "@/i18n";
import type { FxIntentRow } from "@/lib/db/schema";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { describeProposal } from "@/lib/treasury/explain";
import { getRulesRow } from "@/lib/treasury/request-reads";
import type { AppUser } from "@/lib/users/queries";
import { ProposalControls } from "./proposal-controls";

/** Trade approvals §6: what the agent wants to do, why, at what price; token units behind Details. */
export async function ProposalBanner({ user, proposal }: { user: AppUser; proposal: FxIntentRow }) {
  const [row, rates] = await Promise.all([getRulesRow(user.id), getReferenceRatesOrNull()]);
  if (!row) return null;
  const view = describeProposal(proposal, { local: user.localCurrency, rates }, row);
  return (
    <section aria-labelledby="proposal-heading" className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
      <h2 id="proposal-heading" className="flex items-center gap-2 text-lg font-semibold">
        <Hand aria-hidden="true" className="size-5 text-warning" />
        {view.title}
      </h2>
      <p className="font-medium">{view.body}</p>
      <p className="max-w-prose text-muted-foreground">
        {view.why} {view.price}
      </p>
      <ProposalControls key={proposal.id} intentId={proposal.id} seenAtomic={proposal.amountAtomic} />
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("common.details")}</summary>
        <p className="tabular-nums">{view.units}</p>
      </details>
    </section>
  );
}
