"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { approveProposalAction, dismissProposalAction, type ProposalState } from "./actions";

const INITIAL: ProposalState = { outcome: null };

/** "Approve" is the screen's one primary action while a proposal waits (MASTER.md "Buttons"). */
export function ProposalControls({ intentId, seenAtomic }: { intentId: string; seenAtomic: string }) {
  const [approved, approve] = useActionState(approveProposalAction, INITIAL);
  const [dismissed, dismiss] = useActionState(dismissProposalAction, INITIAL);
  const outcome = approved.outcome ?? dismissed.outcome;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <form action={approve}>
          <input type="hidden" name="intentId" value={intentId} />
          <input type="hidden" name="seenAtomic" value={seenAtomic} />
          <SubmitButton pendingLabel={t("proposal.approving")}>{t("proposal.approve")}</SubmitButton>
        </form>
        <form action={dismiss}>
          <input type="hidden" name="intentId" value={intentId} />
          <Button type="submit" variant="outline" size="lg" className="min-h-11">
            {t("proposal.dismiss")}
          </Button>
        </form>
      </div>
      <div aria-live="polite">
        {outcome === "approved" && <p className="text-success">{t("proposal.approved")}</p>}
        {outcome === "dismissed" && <p>{t("proposal.dismissed")}</p>}
      </div>
      {outcome === "changed" && (
        <p role="alert" className="text-destructive">
          {t("proposal.changed")}
        </p>
      )}
    </div>
  );
}
