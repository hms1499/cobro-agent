"use client";

import { ArrowRight, CircleNotch, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { outcomeView } from "@/lib/chat/outcome";
import type { ChatReply } from "@/lib/chat/reply";
import { formatDateTime } from "@/lib/invoices/dates";
import { ASSET_DENOMINATION, type PayAsset } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";
import { formatTokenAmount } from "@/lib/money/format";
import { parseFiatInput } from "@/lib/money/input";
import type { SwapCard as Card } from "@/lib/treasury/chat-swap";
import { tokenFiatAmount } from "@/lib/treasury/value";
import { previewCardAction } from "./chat-actions";

const EDIT_PAUSE_MS = 400;
const link =
  "inline-flex min-h-11 items-center text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A fiat figure as screens show it: the token's own currency, exact (the swap form is the withdraw form's kind). */
export function fiat(asset: PayAsset, atomic: string): string {
  const { amount, currency } = tokenFiatAmount(asset, BigInt(atomic));
  return displayAmount(amount, currency, null, null).primary;
}

/** The line shown beside the field when an edit was answered with something other than a new card. */
function editRefusal(reply: ChatReply): string {
  if (reply.kind === "refused") return t(outcomeView(reply.error).message);
  if (reply.kind === "bad_amount") return t("chat.badAmount");
  if (reply.kind === "paused") return t("chat.paused");
  return t("chat.error.generic");
}

export type CardState = "open" | "running" | "cancelled" | "replaced";

/**
 * Spec §5: what leaves, about what arrives, the auto-convert sentences, and the one primary button. Typing a new
 * amount asks for a new card after a short pause; the exact atomic amount of the shown card is what the tap sends.
 */
export function SwapCard({
  card,
  state,
  step,
  locked,
  usdHome,
  onSwap,
  onCancel,
  onReply,
}: {
  card: Card;
  state: CardState;
  /** True from the tap on (and while a message is being answered): the field, Swap and Cancel are all off. */
  locked: boolean;
  /** A dollars freelancer has no rules form, so the limit sentence carries no link to it. */
  usdHome: boolean;
  /** Plain-words step shown while the swap runs. */
  step: string | null;
  onSwap: (card: Card) => void;
  onCancel: () => void;
  /** `cardId` is the card the edit started from, so the screen can drop an answer for a card no longer open. */
  onReply: (reply: ChatReply, cardId: string) => void;
}) {
  const shown = tokenFiatAmount(card.from, BigInt(card.amountAtomic)).amount;
  const [text, setText] = useState(shown);
  const [syncedId, setSyncedId] = useState(card.cardId);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  // A new card (an edit answered) shows the amount the server settled on.
  if (syncedId !== card.cardId) {
    setSyncedId(card.cardId);
    setText(shown);
    setUpdating(false);
    setError(null);
  }
  useEffect(
    () => () => {
      seq.current += 1;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function cancel() {
    // A pending edit must not bring the card back.
    seq.current += 1;
    if (timer.current) clearTimeout(timer.current);
    onCancel();
  }

  function edit(value: string) {
    if (locked) return;
    setText(value);
    seq.current += 1;
    const mine = seq.current;
    if (timer.current) clearTimeout(timer.current);
    const parsed = parseFiatInput(value);
    if (!parsed.ok) {
      setUpdating(false);
      setError(t(`money.error.${parsed.error}` as const));
      return;
    }
    setError(null);
    if (parsed.value === shown) {
      setUpdating(false);
      return;
    }
    setUpdating(true);
    timer.current = setTimeout(async () => {
      let reply: ChatReply | null = null;
      try {
        reply = await previewCardAction({ from: card.from, to: card.to, amountText: parsed.value, wantedAtomic: null });
      } catch {
        // Shown below; the card stays as it was.
      }
      if (mine !== seq.current) return;
      setUpdating(false);
      if (!reply) setError(t("chat.error.generic"));
      else if (reply.kind === "card") onReply(reply, card.cardId);
      // A refusal (below the minimum while typing "5" on the way to "5000", a passing no_quote) stays beside the field;
      // the card and the typed text stay, and Swap stays off until the amount reads again.
      else setError(editRefusal(reply));
    }, EDIT_PAUSE_MS);
  }

  if (state === "cancelled") return <p className="text-muted-foreground">{t("chat.card.cancelled")}</p>;
  if (state === "replaced") return <p className="text-muted-foreground">{t("chat.card.replaced")}</p>;

  const running = state === "running";
  const off = running || locked;
  const typed = parseFiatInput(text);
  // "25" and "25.00" are the same amount; only a different one needs a new card.
  const dirty = !typed.ok || typed.value !== shown;
  const inputId = `swap-amount-${card.cardId}`;
  const sold = BigInt(card.amountAtomic);
  const bought = BigInt(card.buyAtomic);
  return (
    <section aria-label={t("chat.card.title")} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t("chat.card.amount", { currency: ASSET_DENOMINATION[card.from] })}
        </label>
        <Input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          disabled={off}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(event) => edit(event.target.value)}
          className="h-11 w-48 text-base tabular-nums"
        />
        {error && (
          <p id={`${inputId}-error`} role="alert" className="flex items-start gap-1 text-sm text-destructive">
            <WarningCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-2 tabular-nums">
        <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" />
        {updating ? (
          <span className="text-muted-foreground">{t("chat.card.updating")}</span>
        ) : (
          t("chat.card.estimate", { amount: fiat(card.to, card.buyAtomic) })
        )}
      </p>
      {card.limited === "daily" && (
        <p className="text-sm text-muted-foreground">
          {t("chat.card.limitedDaily")}
          {card.nextDailyAt && <> {t("chat.dailyAt", { when: formatDateTime(new Date(card.nextDailyAt)) })}</>}
          {!usdHome && (
            <>
              {" "}
              <Link href="/app/rules/edit" className={link}>
                {t("chat.card.changeLimit")}
              </Link>
            </>
          )}
        </p>
      )}
      {card.limited === "balance" && <p className="text-sm text-muted-foreground">{t("chat.card.limitedBalance")}</p>}
      {card.turnsOff && <p className="rounded-lg bg-highlight p-3 text-sm">{t("chat.turnsOff")}</p>}
      {card.losesProposal && <p className="rounded-lg bg-highlight p-3 text-sm">{t("chat.losesProposal")}</p>}
      <details className="text-sm">
        <summary className="hover-tint -mx-2 min-h-11 w-fit cursor-pointer rounded-md px-2 py-2 text-primary">{t("common.details")}</summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
          <dt className="text-muted-foreground">{t("chat.card.sold")}</dt>
          <dd>{formatTokenAmount(sold, card.from)}</dd>
          <dt className="text-muted-foreground">{t("chat.card.bought")}</dt>
          <dd>{formatTokenAmount(bought, card.to)}</dd>
        </dl>
      </details>
      {running ? (
        <p role="status" className="flex min-h-11 items-center gap-2 font-medium">
          <CircleNotch aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          {step ?? t("chat.inProgress")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button type="button" size="lg" className="min-h-11" disabled={off || updating || dirty || error !== null} onClick={() => onSwap(card)}>
            {t("chat.swapAction")}
          </Button>
          <Button type="button" variant="ghost" size="lg" className="min-h-11" disabled={off} onClick={cancel}>
            {t("chat.card.cancel")}
          </Button>
        </div>
      )}
    </section>
  );
}
