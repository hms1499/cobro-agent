import { t, type MessageKey } from "@/i18n";
import { formatMoney } from "@/lib/money/format";
import type { ChatSwapError } from "@/lib/treasury/chat-swap";
import { MIN_NOTIONAL_WAD } from "@/lib/treasury/engine";
import { usdWadToDollars } from "@/lib/treasury/value";

export type OutcomeAction = "retry" | "full_balance" | "price_rules" | "daily_rules" | "add_funds" | "none";

/**
 * Spec §5.2: what the freelancer reads for each way a chat swap ends, and the one step offered next. A Record, so a
 * new ChatSwapError does not compile until it is classified.
 */
const OUTCOMES: Record<ChatSwapError, { message: MessageKey; action: OutcomeAction }> = {
  paused: { message: "chat.error.paused", action: "none" },
  disabled: { message: "chat.error.disabled", action: "none" },
  dry_run: { message: "chat.error.dry_run", action: "none" },
  not_ready: { message: "chat.error.not_ready", action: "none" },
  unsupported_pair: { message: "chat.error.unsupported_pair", action: "none" },
  below_minimum: { message: "chat.error.below_minimum", action: "none" },
  insufficient: { message: "chat.error.insufficient", action: "full_balance" },
  daily_limit: { message: "chat.error.daily_limit", action: "daily_rules" },
  busy: { message: "chat.error.busy", action: "retry" },
  needs_gas: { message: "chat.error.needs_gas", action: "add_funds" },
  no_quote: { message: "chat.error.no_quote", action: "retry" },
  price: { message: "chat.error.price", action: "price_rules" },
  expired: { message: "chat.error.expired", action: "retry" },
  // The retry shows the refreshed card and its auto-convert sentence.
  changed: { message: "chat.error.changed", action: "retry" },
  policy: { message: "chat.error.policy", action: "none" },
  swap_failed: { message: "chat.error.swap_failed", action: "retry" },
  // No retry button: the swap may still land, so the freelancer checks History first.
  unconfirmed: { message: "chat.error.unconfirmed", action: "none" },
};

export function outcomeView(error: ChatSwapError): { message: MessageKey; action: OutcomeAction } {
  return OUTCOMES[error];
}

export const MINIMUM_TEXT = formatMoney(usdWadToDollars(MIN_NOTIONAL_WAD), "USD");

/** The sentence the freelancer reads, with the amount it names filled in. */
export function outcomeText(error: ChatSwapError): string {
  return t(OUTCOMES[error].message, { amount: MINIMUM_TEXT });
}

/** For an event or a reply whose stored error is not a known value. */
export function isChatSwapError(value: unknown): value is ChatSwapError {
  return typeof value === "string" && Object.hasOwn(OUTCOMES, value);
}
