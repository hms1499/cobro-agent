import type { ApprovalMode, FxIntentRow } from "@/lib/db/schema";
import type { ConvertReason } from "./engine";

/** Trade approvals spec §2, in the order the rules page lists them. */
export const APPROVAL_MODES = ["auto", "sell_usd", "all"] as const satisfies readonly ApprovalMode[];

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === "string" && (APPROVAL_MODES as readonly string[]).includes(value);
}

/** Trade approvals §3: dismissal silences a group, and a refill's two legs share one approval. */
export type ApprovalGroup = "refill" | "save";

/** Exhaustive: a new ConvertReason does not compile until it is classified. */
const REASON_GROUP: Record<ConvertReason, ApprovalGroup> = {
  top_up: "refill",
  hub_route: "refill",
  save_excess: "save",
  save_other: "save",
};

const reasonsOf = (group: ApprovalGroup): ConvertReason[] =>
  (Object.keys(REASON_GROUP) as ConvertReason[]).filter((reason) => REASON_GROUP[reason] === group);

export const GROUP_REASONS: Record<ApprovalGroup, ConvertReason[]> = {
  refill: reasonsOf("refill"),
  save: reasonsOf("save"),
};

export function approvalGroup(reason: ConvertReason): ApprovalGroup {
  return REASON_GROUP[reason];
}

/** Trade approvals §3: sell_usd asks before a refill (it sells dollars); all asks before anything. */
export function modeNeedsApproval(mode: ApprovalMode, reason: ConvertReason): boolean {
  if (mode === "auto") return false;
  return mode === "all" || approvalGroup(reason) === "refill";
}

/** Trade approvals §5.1 step 6: the price wait (Cobro design spec §10.3) starts at approval, not when the proposal was made. */
export function waitStartedAt(intent: { createdAt: Date; approvedAt: Date | null }): Date {
  return intent.approvedAt ?? intent.createdAt;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The banner's hidden fields. Null for anything malformed, which the action reports as a changed proposal. */
export function parseProposalForm(fields: Record<string, string>): { intentId: string; seenAtomic: bigint } | null {
  const intentId = fields.intentId ?? "";
  const seen = fields.seenAtomic ?? "0";
  if (!UUID.test(intentId) || !/^\d{1,78}$/.test(seen)) return null;
  return { intentId, seenAtomic: BigInt(seen) };
}

/** What proposed, approved and dismissed events carry, in the same shape as the executor's decision data. */
export function intentEventData(intent: Pick<FxIntentRow, "fromAsset" | "toAsset" | "amountAtomic" | "reason">) {
  return { from: intent.fromAsset, to: intent.toAsset, amount: intent.amountAtomic, reason: intent.reason };
}
