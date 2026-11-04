import { describe, expect, it } from "vitest";
import { chooseRequest, refusedActions, twoStepRequest } from "./next-step";
import type { ChatReply } from "./reply";

type Refused = Extract<ChatReply, { kind: "refused" }>;
const refused = (over: Partial<Refused>): Refused => ({
  kind: "refused",
  error: "no_quote",
  availableSellAtomic: null,
  nextDailyAt: null,
  from: "USDT",
  to: "WARS",
  wantedAtomic: "25000000",
  ...over,
});

describe("refusedActions", () => {
  it("retries with the same pair and the typed amount", () => {
    expect(refusedActions(refused({ error: "expired" }))).toEqual([
      { kind: "retry", request: { from: "USDT", to: "WARS", amountText: null, wantedAtomic: "25000000" } },
    ]);
  });

  it("offers a smaller amount only when the depth is known and really smaller", () => {
    const actions = refusedActions(refused({ availableSellAtomic: "10000000" }));
    expect(actions.map((a) => a.kind)).toEqual(["retry", "smaller"]);
    expect(refusedActions(refused({ availableSellAtomic: "30000000" })).map((a) => a.kind)).toEqual(["retry"]);
    expect(refusedActions(refused({ availableSellAtomic: "0" })).map((a) => a.kind)).toEqual(["retry"]);
    expect(refusedActions(refused({ error: "busy", availableSellAtomic: "10000000" })).map((a) => a.kind)).toEqual(["retry"]);
  });

  it("asks for the full balance with no amount", () => {
    expect(refusedActions(refused({ error: "insufficient" }))).toEqual([
      { kind: "full_balance", request: { from: "USDT", to: "WARS", amountText: null, wantedAtomic: null } },
    ]);
  });

  it("offers no card retry when either side of the pair is unknown", () => {
    expect(refusedActions(refused({ from: null }))).toEqual([]);
    expect(refusedActions(refused({ to: null, error: "insufficient" }))).toEqual([]);
  });

  it("links to the rules or the wallet for limits and gas", () => {
    expect(refusedActions(refused({ error: "price" }))).toEqual([{ kind: "link", label: "chat.priceRules", href: "/app/rules/edit" }]);
    expect(refusedActions(refused({ error: "daily_limit" }))).toEqual([{ kind: "link", label: "chat.dailyRules", href: "/app/rules/edit" }]);
    expect(refusedActions(refused({ error: "needs_gas" }))[0]).toMatchObject({ kind: "link", label: "chat.addFunds" });
  });

  it("offers nothing after an unconfirmed swap", () => {
    expect(refusedActions(refused({ error: "unconfirmed" }))).toEqual([]);
  });

  it("keeps the links when the pair is unknown", () => {
    expect(refusedActions(refused({ error: "price", from: null, to: null })).map((a) => a.kind)).toEqual(["link"]);
  });
});

describe("tap requests", () => {
  it("a choice uses the tapped source and the typed amount text", () => {
    const reply = { kind: "choose", to: "WARS", wanted: "25", options: [] } satisfies ChatReply;
    expect(chooseRequest(reply, "USAT")).toEqual({ from: "USAT", to: "WARS", amountText: "25", wantedAtomic: null });
  });

  it("two steps start with the source to USDT, whole balance", () => {
    expect(twoStepRequest({ kind: "two_step", from: "WARS", to: "WBRL" })).toEqual({
      from: "WARS",
      to: "USDT",
      amountText: null,
      wantedAtomic: null,
    });
  });
});
