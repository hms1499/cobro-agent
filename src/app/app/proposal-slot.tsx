"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "@/i18n";
import { approveProposalAction, dismissProposalAction, type ProposalState } from "./actions";

const INITIAL: ProposalState = { outcome: null };

interface ProposalActions {
  approve: (formData: FormData) => void;
  dismiss: (formData: FormData) => void;
  approving: boolean;
  dismissing: boolean;
}

const ProposalActionsContext = createContext<ProposalActions | null>(null);

/** The banner's two form actions and their pending flags. Only valid inside a ProposalSlot. */
export function useProposalActions(): ProposalActions {
  const actions = useContext(ProposalActionsContext);
  if (!actions) throw new Error("useProposalActions needs a ProposalSlot");
  return actions;
}

/**
 * Stays mounted whether or not a proposal exists. Every action refreshes the page, which unmounts the banner
 * after an approve or dismiss, so the result and the "changed" alert live here, not in the banner.
 */
export function ProposalSlot({ children }: { children: ReactNode }) {
  const [approved, approve, approving] = useActionState(approveProposalAction, INITIAL);
  const [dismissed, dismiss, dismissing] = useActionState(dismissProposalAction, INITIAL);
  const [last, setLast] = useState<"approve" | "dismiss" | null>(null);
  const status = useRef<HTMLDivElement>(null);
  // One outcome at a time: the most recent action's.
  const outcome = last === "approve" ? approved.outcome : last === "dismiss" ? dismissed.outcome : null;

  // The banner is gone after a successful action: move focus to the message so keyboard and screen-reader users keep their place.
  useEffect(() => {
    if (outcome) status.current?.focus();
  }, [outcome, approved, dismissed]);

  const actions: ProposalActions = {
    approve: (formData) => {
      setLast("approve");
      approve(formData);
    },
    dismiss: (formData) => {
      setLast("dismiss");
      dismiss(formData);
    },
    approving,
    dismissing,
  };

  return (
    <ProposalActionsContext.Provider value={actions}>
      {children}
      <div ref={status} tabIndex={-1} aria-live="polite" className="outline-none">
        {outcome === "approved" && <p className="text-success">{t("proposal.approved")}</p>}
        {outcome === "dismissed" && <p>{t("proposal.dismissed")}</p>}
        {outcome === "changed" && (
          <p role="alert" className="text-destructive">
            {t("proposal.changed")}
          </p>
        )}
      </div>
    </ProposalActionsContext.Provider>
  );
}
