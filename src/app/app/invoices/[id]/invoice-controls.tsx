"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react/ssr";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { cancelInvoiceAction, stopRecurringAction, type InvoiceActionState } from "./actions";

const IDLE: InvoiceActionState = { outcome: null };

/**
 * One destructive control with an inline confirmation (MASTER.md: destructive actions sit apart from
 * the primary action and are confirmed). The first button only opens the question; nothing changes
 * until "Yes, …" is pressed.
 */
function Confirmed({
  action,
  hidden,
  open,
  title,
  body,
  yes,
  no,
}: {
  action: (state: InvoiceActionState, formData: FormData) => Promise<InvoiceActionState>;
  hidden: { name: string; value: string };
  open: MessageKey;
  title: string;
  body: string;
  yes: MessageKey;
  no: MessageKey;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  const [asking, setAsking] = useState(false);
  if (state.outcome === "cancelled" || state.outcome === "stopped") {
    return (
      <p role="status" className="enter-in flex items-start gap-2 text-sm font-medium text-success">
        <CheckCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t(state.outcome === "cancelled" ? "invoice.cancelDone" : "invoice.stopDone")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {state.outcome === "not_cancellable" && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <WarningCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("invoice.cancelRefused")}
        </p>
      )}
      {asking ? (
        <form action={formAction} className="flex flex-col gap-3 rounded-lg bg-destructive/5 p-4 ring-1 ring-destructive/20">
          <input type="hidden" name={hidden.name} value={hidden.value} />
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SubmitButton variant="destructive" pendingLabel={t("invoice.working")}>
              {t(yes)}
            </SubmitButton>
            <Button type="button" variant="ghost" size="lg" className="min-h-11" onClick={() => setAsking(false)}>
              {t(no)}
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="ghost" size="lg" className="min-h-11 w-fit text-destructive" onClick={() => setAsking(true)}>
          {t(open)}
        </Button>
      )}
    </div>
  );
}

/** Cancel an unpaid invoice and, for a recurring one, stop future periods (both on the invoice page). */
export function InvoiceControls({
  invoiceId,
  canCancel,
  recurring,
  clientName,
}: {
  invoiceId: string;
  canCancel: boolean;
  recurring: { id: string; active: boolean } | null;
  clientName: string;
}) {
  if (!canCancel && !recurring?.active) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      {canCancel && (
        <Confirmed
          action={cancelInvoiceAction}
          hidden={{ name: "invoiceId", value: invoiceId }}
          open="invoice.cancel"
          title={t("invoice.cancelTitle")}
          body={t("invoice.cancelBody")}
          yes="invoice.cancelYes"
          no="invoice.cancelNo"
        />
      )}
      {recurring?.active && (
        <Confirmed
          action={stopRecurringAction}
          hidden={{ name: "recurringId", value: recurring.id }}
          open="invoice.stop"
          title={t("invoice.stopTitle")}
          body={t("invoice.stopBody", { client: clientName })}
          yes="invoice.stopYes"
          no="invoice.stopNo"
        />
      )}
    </div>
  );
}
