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
  | { kind: "link"; label: MessageKey; href: string }
  /** Plain steps and the wallet address behind a disclosure; the screen draws it. */
  | { kind: "add_funds" };

const isPositive = (atomic: string | null): atomic is string => atomic !== null && /^\d+$/.test(atomic) && BigInt(atomic) > 0n;

/**
 * The next steps for a refused reply. "Try again" keeps the pair and the typed amount. With either side of the pair
 * unknown (a swap picked up after a reload, with no card) no card can be asked for, so only links remain. A dollars
 * freelancer has no rules form (/app/rules/edit sends them back), so the links to it are left out.
 */
export function refusedActions(reply: Refused, opts: { usdHome: boolean }): RefusedAction[] {
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
    // Spec §5.2: "Try again" and the link to the price limit.
    const retry = request(reply.wantedAtomic);
    if (retry) actions.push({ kind: "retry", request: retry });
    if (!opts.usdHome) actions.push({ kind: "link", label: "chat.priceRules", href: "/app/rules/edit" });
  } else if (action === "daily_rules") {
    if (!opts.usdHome) actions.push({ kind: "link", label: "chat.dailyRules", href: "/app/rules/edit" });
  } else if (action === "add_funds") {
    actions.push({ kind: "add_funds" });
  }
  // The swap may still land, so the freelancer checks History before anything else.
  if (reply.error === "unconfirmed") actions.push({ kind: "link", label: "chat.viewHistory", href: "/app/rules/history" });
  return actions;
}

/** A tap on one of the `choose` options: that source, the amount the freelancer typed (text, not atomic). */
export function chooseRequest(reply: Extract<ChatReply, { kind: "choose" }>, from: PayAsset): CardRequest {
  return { from, to: reply.to, amountText: reply.wanted, wantedAtomic: null };
}

/** `two_step`: the first leg is the source to USDT, for the amount typed (text, not atomic) or else the whole balance. */
export function twoStepRequest(reply: Extract<ChatReply, { kind: "two_step" }>): CardRequest {
  return { from: reply.from, to: "USDT", amountText: reply.wanted, wantedAtomic: null };
}
