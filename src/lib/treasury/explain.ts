// src/lib/treasury/explain.ts
import { t, type MessageKey } from "@/i18n";
import { TOKENS } from "@/lib/chain/tokens";
import type { AgentEventType, FxIntentRow } from "@/lib/db/schema";
import type { ReferenceRates } from "@/lib/fx/rates";
import { formatDecimal } from "@/lib/money/decimal";
import { isPayAsset, type LocalCurrency } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";
import { formatMoney } from "@/lib/money/format";
import type { Decision, IdleReason } from "./engine";
import { MIN_NOTIONAL_WAD } from "./engine";
import { DRIP_AMOUNT_ATOMIC } from "./gas";
import { formatCents, tokenFiatAmount, usdWadToDollars } from "./value";

export interface ExplainContext {
  local: LocalCurrency | null;
  rates: ReferenceRates | null;
}

export type EventTone = "success" | "warning" | "alert" | "info";

export interface EventView {
  tone: EventTone;
  title: string;
  why: string;
  txHash: string | null;
}

/** A token amount as people read it: local currency first (spec §17.1 principle 2), never raw units. */
export function moneyText(
  asset: unknown,
  atomic: unknown,
  ctx: ExplainContext,
): string {
  if (!isPayAsset(asset) || typeof atomic !== "string" || !/^\d+$/.test(atomic))
    return t("event.someMoney");
  const { amount, currency } = tokenFiatAmount(asset, BigInt(atomic));
  return displayAmount(amount, currency, ctx.local, ctx.rates).primary;
}

/** Basis points as a percentage with two decimals ("0.50%"). */
export function percentText(bps: unknown): string {
  const value = typeof bps === "number" && bps > 0 ? Math.round(bps) : 0;
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}%`;
}

function targetText(asset: unknown): string {
  if (asset === "WARS") return t("event.target.ARS");
  if (asset === "WBRL") return t("event.target.BRL");
  return t("event.target.USD");
}

/** A refill through USD₮ (hub_route) is for the spending currency, though its first leg buys USD₮. */
function proposalTarget(to: unknown, reason: unknown, local: LocalCurrency | null): string {
  if (reason === "hub_route" && local) return t(`event.target.${local}`);
  return targetText(to);
}

const REASONS: Record<string, MessageKey> = {
  save_excess: "event.why.save_excess",
  save_other: "event.why.save_other",
  top_up: "event.why.top_up",
  hub_route: "event.why.hub_route",
};
// Fiat amounts in copy come from the constants that define them, through formatMoney.
const DRIP_TEXT = formatMoney(formatCents(DRIP_AMOUNT_ATOMIC / 10_000n), "USD"); // USDC has 6 decimals
const MINIMUM_TEXT = formatMoney(usdWadToDollars(MIN_NOTIONAL_WAD), "USD");
const reasonText = (reason: unknown) =>
  t(REASONS[String(reason)] ?? "event.why.generic");

/** The activity feed's title and "Why?" text for one event (spec §17.1 principle 4). */
export function describeEvent(
  event: { type: AgentEventType; data: Record<string, unknown> },
  ctx: ExplainContext,
): EventView {
  const d = event.data;
  const amount = moneyText(d.from ?? d.asset, d.amount, ctx);
  const txHash = typeof d.txHash === "string" ? d.txHash : null;
  const simple = (
    tone: EventTone,
    key:
      | "policy_rejected"
      | "swap_failed"
            | "needs_gas"
      | "withdraw_failed"
      | "paused"
      | "resumed"
      | "payment_reconciled",
  ): EventView => ({
    tone,
    title: t(`event.${key}.title`),
    why: t(`event.${key}.why`),
    txHash,
  });
  switch (event.type) {
    case "converted": {
      const bps = typeof d.slippageBps === "number" ? d.slippageBps : 0;
      const price =
        bps > 0
          ? t("event.price.worse", { pct: percentText(bps) })
          : t("event.price.better");
      return {
        tone: "success",
        title: t("event.converted.title", { amount, target: targetText(d.to) }),
        why: `${reasonText(d.reason)} ${price}`,
        txHash,
      };
    }
    case "dry_run":
      return {
        tone: "info",
        title: t("event.dry_run.title", { amount, target: targetText(d.to) }),
        why: `${reasonText(d.reason)} ${t("event.dry_run.why")}`,
        txHash: null,
      };
    case "waiting":
      return {
        tone: "warning",
        title: t("event.waiting.title"),
        why: t("event.waiting.why", {
          amount,
          pct: percentText(d.slippageBps),
          limit: percentText(d.limitBps),
        }),
        txHash: null,
      };
    case "blocked":
      return {
        tone: "alert",
        title: t("event.blocked.title"),
        why: t("event.blocked.why", {
          amount,
          pct: percentText(d.slippageBps),
          limit: percentText(d.limitBps),
        }),
        txHash: null,
      };
    case "no_quote":
      return {
        tone: "warning",
        title: t("event.no_quote.title"),
        why: t("event.no_quote.why", { amount }),
        txHash: null,
      };
    case "proposed":
    case "approved":
    case "dismissed":
      return {
        tone: event.type === "proposed" ? "warning" : "info",
        title: t(`event.${event.type}.title`, { amount, target: proposalTarget(d.to, d.reason, ctx.local) }),
        why: t(`event.${event.type}.why`),
        txHash: null,
      };
    case "withdrawn":
      return {
        tone: "success",
        title: t("event.withdrawn.title", { amount }),
        why: t("event.withdrawn.why"),
        txHash,
      };
    case "policy_rejected":
      return simple("alert", "policy_rejected");
    case "swap_failed":
      return simple("alert", "swap_failed");
    case "withdraw_failed":
      return simple("alert", "withdraw_failed");
    case "needs_gas":
      return simple("warning", "needs_gas");
    case "gas_dripped":
      return {
        tone: "info",
        title: t("event.gas_dripped.title"),
        why: t("event.gas_dripped.why", { amount: DRIP_TEXT }),
        txHash,
      };
    case "paused":
      return simple("info", "paused");
    case "resumed":
      return simple("info", "resumed");
    case "payment_reconciled":
      return simple("success", "payment_reconciled");
  }
}

export interface ProposalView {
  title: string;
  body: string;
  why: string;
  price: string;
  /** Token units, shown only behind "Details". */
  units: string;
}

/** The dashboard banner's text for one proposal (trade approvals §6). */
export function describeProposal(
  intent: Pick<FxIntentRow, "fromAsset" | "toAsset" | "amountAtomic" | "reason">,
  ctx: ExplainContext,
  limits: { maxSlippageBps: number; hardMaxSlippageBps: number; maxWaitMinutes: number },
): ProposalView {
  const { amount, currency } = tokenFiatAmount(intent.fromAsset, BigInt(intent.amountAtomic));
  const shown = displayAmount(amount, currency, ctx.local, ctx.rates);
  // The source amount in its own currency first; the other currency is only an estimate, so it follows in parentheses.
  const exact = formatMoney(amount, currency);
  const estimate = [shown.primary, shown.secondary].find((text) => text !== undefined && text !== exact);
  const from = currency === "USD" ? t("proposal.fromDollars", { amount: exact }) : exact;
  const target = proposalTarget(intent.toAsset, intent.reason, ctx.local);
  const via = intent.reason === "hub_route";
  const key = via
    ? estimate ? "proposal.bodyViaEstimate" : "proposal.bodyVia"
    : estimate ? "proposal.bodyEstimate" : "proposal.body";
  return {
    title: t("proposal.title"),
    body: t(key, { from, target, estimate: estimate ?? "" }),
    why: t(`proposal.why.${intent.reason}`),
    price: t("proposal.price", {
      pct: percentText(limits.maxSlippageBps),
      hard: percentText(limits.hardMaxSlippageBps),
      hours: String(Math.round(limits.maxWaitMinutes / 60)),
    }),
    units: t("proposal.units", {
      amount: formatDecimal(BigInt(intent.amountAtomic), TOKENS[intent.fromAsset].decimals),
      symbol: t(`asset.${intent.fromAsset}.symbol`),
    }),
  };
}

const IDLE: Record<IdleReason, MessageKey> = {
  within_band: "preview.within_band",
  daily_cap: "preview.daily_cap",
  below_minimum: "preview.below_minimum",
  no_dollars: "preview.no_dollars",
};

/** Completes "If the agent ran now, it would …" on the rules page (spec §17.2). */
export function describeDecision(
  decision: Decision,
  ctx: ExplainContext,
  opts: { askFirst?: boolean } = {},
): string {
  if (decision.kind === "none")
    return t(IDLE[decision.reason], { amount: MINIMUM_TEXT });
  return t(opts.askFirst ? "preview.propose" : "preview.convert", {
    amount: moneyText(decision.from, decision.amount.toString(), ctx),
    target: targetText(decision.to),
    why: reasonText(decision.reason),
  });
}
