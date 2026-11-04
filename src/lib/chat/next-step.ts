import type { MessageKey } from "@/i18n";
import type { PayAsset } from "@/lib/money/currencies";
import { outcomeView } from "./outcome";
import type { CardRequest, ChatReply } from "./reply";

type Refused = Extract<ChatReply, { kind: "refused" }>;

/** One step offered after a refusal (spec §5.2). A card step asks for a new card; a link goes to a screen. */
export type RefusedAction =
  | { kind: "retry"; request: CardRequest }
  | { kind: "full_balance"; request: CardRequest }
  | { kind: "smaller"; request: CardRequest; atomic: string; from: PayAsset }
  | { kind: "link"; label: MessageKey; href: string };

const isPositive = (atomic: string | null): atomic is string => atomic !== null && /^\d+$/.test(atomic) && BigInt(atomic) > 0n;

/**
 * The next steps for a refused reply. "Try again" keeps the pair and the typed amount. With either side of the pair
 * unknown (a failed read of a message that named none) no card can be asked for, so only links remain.
 */
export function refusedActions(reply: Refused): RefusedAction[] {
  const { from, to } = reply;
  const action = outcomeView(reply.error).action;
  const actions: RefusedAction[] = [];
  const request = (wantedAtomic: string | null): CardRequest | null =>
    from && to ? { from, to, amountText: null, wantedAtomic } : null;

  if (action === "retry") {
    const retry = request(reply.wantedAtomic);
    if (retry) actions.push({ kind: "retry", request: retry });
    // Spec §5.2: a smaller amount when the depth is known, and only when it really is smaller than what was asked.
    const smaller = request(reply.availableSellAtomic);
    const asked = reply.wantedAtomic;
    if (reply.error === "no_quote" && smaller && from && isPositive(reply.availableSellAtomic) && (!isPositive(asked) || BigInt(reply.availableSellAtomic) < BigInt(asked))) {
      actions.push({ kind: "smaller", request: smaller, atomic: reply.availableSellAtomic, from });
    }
  } else if (action === "full_balance") {
    const full = request(null);
    if (full) actions.push({ kind: "full_balance", request: full });
  } else if (action === "price_rules") {
    actions.push({ kind: "link", label: "chat.priceRules", href: "/app/rules/edit" });
  } else if (action === "daily_rules") {
    actions.push({ kind: "link", label: "chat.dailyRules", href: "/app/rules/edit" });
  } else if (action === "add_funds") {
    actions.push({ kind: "link", label: "chat.addFunds", href: "/app/settings" });
  }
  return actions;
}

/** A tap on one of the `choose` options: that source, the amount the freelancer typed (text, not atomic). */
export function chooseRequest(reply: Extract<ChatReply, { kind: "choose" }>, from: PayAsset): CardRequest {
  return { from, to: reply.to, amountText: reply.wanted, wantedAtomic: null };
}

/** `two_step`: the first leg is the source to USDT, for the whole balance. */
export function twoStepRequest(reply: Extract<ChatReply, { kind: "two_step" }>): CardRequest {
  return { from: reply.from, to: "USDT", amountText: null, wantedAtomic: null };
}
