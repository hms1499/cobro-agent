import { describe, expect, it } from "vitest";
import {
  approvalGroup,
  intentEventData,
  isApprovalMode,
  modeNeedsApproval,
  parseProposalForm,
  waitStartedAt,
} from "./approvals";

describe("modeNeedsApproval", () => {
  it.each([
    ["auto", "top_up", false],
    ["auto", "hub_route", false],
    ["auto", "save_excess", false],
    ["auto", "save_other", false],
    ["sell_usd", "top_up", true],
    ["sell_usd", "hub_route", true],
    ["sell_usd", "save_excess", false],
    ["sell_usd", "save_other", false],
    ["all", "top_up", true],
    ["all", "hub_route", true],
    ["all", "save_excess", true],
    ["all", "save_other", true],
  ] as const)("%s mode, %s → %s", (mode, reason, expected) => {
    expect(modeNeedsApproval(mode, reason)).toBe(expected);
  });
});

describe("approvalGroup", () => {
  it("puts refills and savings in separate groups", () => {
    expect([approvalGroup("top_up"), approvalGroup("hub_route")]).toEqual(["refill", "refill"]);
    expect([approvalGroup("save_excess"), approvalGroup("save_other")]).toEqual(["save", "save"]);
  });
});

describe("isApprovalMode", () => {
  it("accepts the three modes only", () => {
    expect(["auto", "sell_usd", "all"].every(isApprovalMode)).toBe(true);
    expect(isApprovalMode("sometimes")).toBe(false);
    expect(isApprovalMode(undefined)).toBe(false);
  });
});

describe("waitStartedAt", () => {
  it("counts the price wait from approval when there was one", () => {
    const createdAt = new Date("2026-10-15T04:00:00Z");
    const approvedAt = new Date("2026-10-15T12:00:00Z");
    expect(waitStartedAt({ createdAt, approvedAt })).toBe(approvedAt);
    expect(waitStartedAt({ createdAt, approvedAt: null })).toBe(createdAt);
  });
});

describe("parseProposalForm", () => {
  const id = "0b8f8a52-3c1e-4a8e-9a55-0d6f3c2f1e10";

  it("reads the proposal id and the amount the banner showed", () => {
    expect(parseProposalForm({ intentId: id, seenAtomic: "2100000" })).toEqual({ intentId: id, seenAtomic: 2_100_000n });
    expect(parseProposalForm({ intentId: id })).toEqual({ intentId: id, seenAtomic: 0n });
  });

  it("refuses anything else", () => {
    expect(parseProposalForm({ intentId: "not-a-uuid", seenAtomic: "1" })).toBeNull();
    expect(parseProposalForm({ intentId: id, seenAtomic: "1.5" })).toBeNull();
    expect(parseProposalForm({ intentId: id, seenAtomic: "-1" })).toBeNull();
    expect(parseProposalForm({})).toBeNull();
  });
});

describe("intentEventData", () => {
  it("keeps what the activity feed needs", () => {
    expect(intentEventData({ fromAsset: "USDT", toAsset: "WARS", amountAtomic: "2100000", reason: "top_up" })).toEqual({
      from: "USDT",
      to: "WARS",
      amount: "2100000",
      reason: "top_up",
    });
  });
});
