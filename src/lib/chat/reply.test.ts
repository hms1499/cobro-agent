import { describe, expect, it, vi } from "vitest";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import type { SwapCard } from "@/lib/treasury/chat-swap";
import { cardReply, chatReply, MAX_CHAT_TEXT, type ReplyIo } from "./reply";

const RATES = { USD: 1, ARS: 1000, BRL: 5 } as never;
const zero = { USAT: 0n, USDT: 0n, WARS: 0n, WBRL: 0n, USDC: 0n } as unknown as TreasuryBalances;
const card: SwapCard = {
  cardId: "11111111-1111-4111-8111-111111111111",
  from: "USDT", to: "WARS", amountAtomic: "25000000", buyAtomic: "1", limited: null, turnsOff: false, losesProposal: false, nextDailyAt: null,
};
const shown = { USAT: "0.00", USDT: "50.00", WARS: "0.00", WBRL: "0.00" };

function io(over: Partial<ReplyIo> = {}): ReplyIo {
  return {
    balances: async () => ({ ...zero, USDT: 50_000_000n }),
    rates: async () => RATES,
    displayBalances: async () => shown,
    preview: vi.fn(async () => card),
    interpret: vi.fn(async () => null),
    ...over,
  };
}

describe("chatReply", () => {
  it("answers a clear command with a card and never calls Groq", async () => {
    const deps = io();
    const reply = await chatReply("swap 25 usdt to wars", deps);
    expect(reply).toEqual({ kind: "card", card });
    expect(deps.preview).toHaveBeenCalledWith({ from: "USDT", to: "WARS", wanted: 25_000_000n });
    expect(deps.interpret).not.toHaveBeenCalled();
  });

  it("refuses text over the cap before any parser or Groq", async () => {
    const deps = io();
    expect(await chatReply("swap 25 usdt to wars" + " ".repeat(MAX_CHAT_TEXT), deps)).toEqual({ kind: "help" });
    expect(deps.interpret).not.toHaveBeenCalled();
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it("asks Groq only for an unknown message, and runs its draft through the resolver", async () => {
    const interpret = vi.fn(async () => ({ kind: "swap", from: "USDT", to: "USDT", amount: null }) as const);
    expect(await chatReply("please change my money", io({ interpret }))).toEqual({ kind: "same_token" });
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it("answers help when Groq returns null or unknown", async () => {
    expect(await chatReply("blah", io())).toEqual({ kind: "help" });
    expect(await chatReply("blah", io({ interpret: async () => ({ kind: "unknown" }) }))).toEqual({ kind: "help" });
  });

  it("carries the balances in nothing_to_swap and balances replies", async () => {
    const empty = io({ balances: async () => zero });
    expect(await chatReply("swap to wars", empty)).toEqual({ kind: "nothing_to_swap", to: "WARS", balances: shown });
    expect(await chatReply("what do i have?", empty)).toEqual({ kind: "balances", balances: shown });
  });

  it("maps a refused preview onto the reply, with the pair", async () => {
    const preview = async () => ({ refused: "daily_limit" as const, availableSellAtomic: null, nextDailyAt: "2026-11-05T00:00:00.000Z" });
    expect(await chatReply("swap 25 usdt to wars", io({ preview }))).toEqual({
      kind: "refused", error: "daily_limit", availableSellAtomic: null, nextDailyAt: "2026-11-05T00:00:00.000Z", from: "USDT", to: "WARS",
    });
  });

  it("answers no_quote, logging only a tag, when a read throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = new Error("rpc https://node/secret-key failed");
    const reply = await chatReply("swap 25 usdt to wars", io({ balances: async () => { throw secret; } }));
    expect(reply).toMatchObject({ kind: "refused", error: "no_quote", from: "USDT", to: "WARS" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-key");
    spy.mockRestore();
  });
});

describe("cardReply", () => {
  it("parses the typed amount into atomic units and issues the card through preview", async () => {
    const deps = io();
    expect(await cardReply({ from: "USDT", to: "WARS", amountText: "12,50", wantedAtomic: null }, deps)).toEqual({ kind: "card", card });
    expect(deps.preview).toHaveBeenCalledWith({ from: "USDT", to: "WARS", wanted: 12_500_000n });
  });

  it("uses wantedAtomic when no text is typed, and none for the full balance", async () => {
    const deps = io();
    await cardReply({ from: "USDT", to: "WARS", amountText: null, wantedAtomic: "7000000" }, deps);
    await cardReply({ from: "USDT", to: "WARS", amountText: null, wantedAtomic: null }, deps);
    expect(deps.preview).toHaveBeenNthCalledWith(1, { from: "USDT", to: "WARS", wanted: 7_000_000n });
    expect(deps.preview).toHaveBeenNthCalledWith(2, { from: "USDT", to: "WARS", wanted: null });
  });

  it("rejects bad input without previewing", async () => {
    const deps = io();
    expect(await cardReply({ from: "USDT", to: "WARS", amountText: "1e3", wantedAtomic: null }, deps)).toEqual({ kind: "bad_amount" });
    expect(await cardReply({ from: "USDT", to: "WARS", amountText: null, wantedAtomic: "-5" }, deps)).toEqual({ kind: "bad_amount" });
    expect(await cardReply({ from: "USDT", to: "USDT", amountText: null, wantedAtomic: null }, deps)).toEqual({ kind: "same_token" });
    expect(await cardReply({ from: "ETH" as never, to: "USDT", amountText: null, wantedAtomic: null }, deps)).toEqual({ kind: "help" });
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it("answers no_quote when the preview throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const preview = async () => { throw new Error("boom"); };
    expect(await cardReply({ from: "USDT", to: "WARS", amountText: null, wantedAtomic: null }, io({ preview }))).toMatchObject({ kind: "refused", error: "no_quote" });
    spy.mockRestore();
  });
});
