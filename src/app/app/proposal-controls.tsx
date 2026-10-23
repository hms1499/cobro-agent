"use client";

import { CircleNotch } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useProposalActions } from "./proposal-slot";

/** "Approve" is the screen's one primary action while a proposal waits (MASTER.md "Buttons"). */
export function ProposalControls({ intentId, seenAtomic }: { intentId: string; seenAtomic: string }) {
  const { approve, dismiss, approving, dismissing } = useProposalActions();
  const busy = approving || dismissing;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={approve}>
        <input type="hidden" name="intentId" value={intentId} />
        <input type="hidden" name="seenAtomic" value={seenAtomic} />
        <Button type="submit" size="lg" className="min-h-11 w-full sm:w-auto" disabled={busy} aria-disabled={busy}>
          {approving && <CircleNotch aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
          {approving ? t("proposal.approving") : t("proposal.approve")}
        </Button>
      </form>
      <form action={dismiss}>
        <input type="hidden" name="intentId" value={intentId} />
        <Button type="submit" variant="outline" size="lg" className="min-h-11" disabled={busy} aria-disabled={busy}>
          {dismissing && <CircleNotch aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
          {dismissing ? t("proposal.dismissing") : t("proposal.dismiss")}
        </Button>
      </form>
    </div>
  );
}
