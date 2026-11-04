"use client";

import { Play } from "@phosphor-icons/react/ssr";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { t } from "@/i18n";
import { turnAutoConvertOn } from "./actions";

/**
 * Chat-swap spec §3.2: turning the agent back on first says what it would now do. `preview` is rendered on the
 * server (the engine on live balances) and shown here; `action` is the form action that does the turning on.
 * Outline, not primary: the screen's one primary action stays where MASTER.md puts it.
 */
export function ConfirmTurnOn({
  label,
  preview,
  action,
  fields,
  id,
}: {
  label: string;
  preview: ReactNode;
  action: (formData: FormData) => Promise<void> | void;
  /** Hidden inputs the action reads. */
  fields?: Record<string, string>;
  /** Anchor for same-page links; the element takes focus when they land on it. */
  id?: string;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className={`flex flex-col gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring ${asking ? "basis-full" : ""}`}>
      {asking ? (
        <form action={action} className="flex flex-col gap-3 rounded-lg bg-highlight/60 p-4 ring-1 ring-foreground/10 sm:flex-row sm:flex-wrap sm:items-center">
          {Object.entries(fields ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {/* The slot holds the sentence and the Confirm button together, so Confirm exists only once the sentence does. */}
          {preview}
          <Button type="button" variant="ghost" size="lg" className="min-h-11" onClick={() => setAsking(false)}>
            {t("agent.turnOnCancel")}
          </Button>
        </form>
      ) : (
        <Button type="button" variant="outline" size="lg" className="min-h-11 w-fit" onClick={() => setAsking(true)}>
          <Play aria-hidden="true" className="size-4" />
          {label}
        </Button>
      )}
    </div>
  );
}

/** Status panel, Auto-convert off: the one place that turns it back on (the chat card links here). */
export function AutoConvertControl({ preview }: { preview: ReactNode }) {
  return <ConfirmTurnOn id="auto-convert" label={t("agent.autoOn")} preview={preview} action={turnAutoConvertOn} />;
}

/** The Confirm button once the sentence above it is on screen. */
export function ConfirmEnabled() {
  return (
    <SubmitButton variant="outline" pendingLabel={t("agent.working")}>
      {t("agent.turnOnConfirm")}
    </SubmitButton>
  );
}

/** Stands in for Confirm while the sentence loads, so nobody confirms before reading it. */
export function ConfirmWaiting() {
  return (
    <Button type="button" variant="outline" size="lg" className="min-h-11" disabled aria-disabled="true">
      {t("agent.turnOnConfirm")}
    </Button>
  );
}
