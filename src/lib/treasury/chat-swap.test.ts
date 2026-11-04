// src/lib/treasury/chat-swap.test.ts
import { eq, sql } from "drizzle-orm";
import { getAddress, type Hex } from "viem";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { TEXTILE_REACTOR, type GasToken } from "@/lib/chain/treasury-tx";
import type { Db } from "@/lib/db/client";
import { agentEvents, fxIntents, fxTrades, rules, treasuryTxs } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import type { ReferenceRates } from "@/lib/fx/rates";
import { TextileError, type FirmQuote, type RfqOutcome, type RfqPreview } from "@/lib/fx/rfq";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import {
  activeChatCardId,
  chatSwap,
  chatSwapStatus,
  previewChatSwap,
  type ChatPreviewDeps,
  type ChatSwapStatus,
  type SwapCard,
} from "./chat-swap";
import { reconcileWallets, TxRejectedError, type ExecutorDeps } from "./executor";
import {
  acquireWalletLock,
  loadTreasuryContext,
  nextDailyCapacityAt,
  recordTreasuryTx,
  releaseWalletLock,
  runHolder,
  setAutoConvertOn,
  walletLockHolder,
} from "./repo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = new Date("2026-10-15T12:00:00Z");
const HOUR = 3_600_000;
const CARD = "3f0c1a52-7d4e-4b6a-9c11-2e5f8a7b6c01";
const OTHER_CARD = "9a7b6c01-2e5f-4b6a-8c11-3f0c1a527d4e";
const RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const pesos = (n: bigint) => n * 10n ** 18n;
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };
const TREASURY = getAddress(TEST_TREASURY);
const hashOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const rawOf = (n: number) => `0x${"ab".repeat(n)}` as Hex;

/** Sell 3,200 wARS (US$2) for 1.99 USD₮: 50 bps worse than the reference, exactly the default limit. */
function quoted(over: Partial<FirmQuote> = {}): RfqOutcome {
  return {
    status: "quoted",
    quote: {
      rfqId: "rfq_1",
      claimToken: "claim_1",
      sellAmount: pesos(3_200n),
      buyAmount: 1_990_000n,
      feeAmount: 0n,
      takerPays: pesos(3_200n),
      expiresAt: new Date(NOW.getTime() + 60_000),
      spender: TEXTILE_REACTOR,
      taker: TREASURY,
      swap: { to: TEXTILE_REACTOR, data: "0xabcdef", value: 0n, chainId: 42220 },
      ...over,
    },
  };
}

/** Buy 3,184 wARS with US$2: the same 50 bps. With no reserve, the agent would sell these pesos straight back. */
const buyQuote = (over: Partial<FirmQuote> = {}) =>
  quoted({ sellAmount: 2_000_000n, takerPays: 2_000_000n, buyAmount: pesos(3_184n), ...over });

const SELL = { from: "WARS", to: "USDT", amount: pesos(3_200n), cardId: CARD, seenTurnsOff: false } as const;
const BUY = { from: "USDT", to: "WARS", amount: 2_000_000n, cardId: CARD, seenTurnsOff: true } as const;
const SELL_BALANCES = { WARS: pesos(3_200n), USDT: 1_000_000n };
const BUY_BALANCES = { USDT: 5_000_000n };

function preview(buyAmount: bigint, takerPays: bigint): RfqPreview {
  return { status: "preview", sellAmount: takerPays, buyAmount, feeAmount: 0n, takerPays, availableSellAmount: null };
}

/** The real database around a fake chain, signer and Textile. Signed transaction n has hash hashOf(n) and raw bytes rawOf(n). */
function harness(balances: Partial<TreasuryBalances>, outcome: RfqOutcome = quoted()) {
  const state = {
    balances: { ...ZERO, ...balances },
    /** Enough by default, so only the swap is signed; set to 0n to go through the approval. */
    allowance: 10n ** 30n,
    receipts: new Map<string, "success" | "reverted" | null>(),
    sent: [] as Hex[],
    refused: new Set<string>(),
    outcome,
    preview: preview(1_990_000n, pesos(3_200n)) as RfqPreview,
  };
  const signed: { feeToken: GasToken }[] = [];
  const deps: ExecutorDeps & ChatPreviewDeps = {
    db,
    now: () => NOW,
    flags: { enabled: true, dryRun: false },
    rates: async () => RATES,
    chain: {
      readBalances: async () => ({ ...state.balances }),
      allowance: async () => state.allowance,
      receipt: async (hash) => state.receipts.get(hash) ?? null,
      confirmedNonce: async () => 0,
      knownTx: async () => true,
      sendRaw: async (raw) => {
        if (state.refused.has(raw)) throw new TxRejectedError("invalid sender");
        state.sent.push(raw);
      },
      waitForReceipt: async (hash) => (state.receipts.has(hash) ? (state.receipts.get(hash) ?? null) : "success"),
    },
    signer: () => ({ address: TREASURY, signDigest: vi.fn(), signTypedData: vi.fn(async () => "0x5151" as Hex) }),
    signTx: vi.fn<ExecutorDeps["signTx"]>(async (_signer, _call, feeToken) => {
      signed.push({ feeToken });
      const n = signed.length;
      return { hash: hashOf(n), raw: rawOf(n), nonce: n, feeToken };
    }),
    rfq: {
      request: vi.fn(async () => state.outcome),
      cancel: vi.fn(async () => {}),
      submit: vi.fn(async () => {}),
    },
    drip: vi.fn(async () => "0xd1" as Hex),
    allowedSpenders: [TEXTILE_REACTOR],
    preview: vi.fn<ChatPreviewDeps["preview"]>(async () => state.preview),
  };
  return { deps, state, signed };
}

type Harness = ReturnType<typeof harness>;

const seed = () => seedFreelancer(db);
const setRules = (userId: string, fields: Partial<typeof rules.$inferInsert>) => db.update(rules).set(fields).where(eq(rules.userId, userId));
const autoPausedAt = async (userId: string) => (await db.select().from(rules).where(eq(rules.userId, userId)))[0].autoPausedAt;
const tradesOf = (userId: string) => db.select().from(fxTrades).where(eq(fxTrades.userId, userId));
const intentsOf = (userId: string) => db.select().from(fxIntents).where(eq(fxIntents.userId, userId));
const eventsOf = (userId: string) => db.select().from(agentEvents).where(eq(agentEvents.userId, userId));
const eventTypes = async (userId: string) => (await eventsOf(userId)).map((e) => e.type);
const refusals = async (userId: string) =>
  (await eventsOf(userId)).filter((e) => e.type === "chat_swap_refused").map((e) => e.data.error);
const walletOf = async (userId: string) => (await loadTreasuryContext(db, userId))!.walletId;
const walletHolder = async (userId: string) => walletLockHolder(db, await walletOf(userId));
const status = (userId: string, cardId = CARD, now = NOW) => chatSwapStatus(db, userId, cardId, now);
const openIntentRow = (userId: string, intentStatus: "waiting" | "proposed" = "waiting") =>
  db.insert(fxIntents).values({
    userId,
    fromAsset: "WARS",
    toAsset: "USDT",
    amountAtomic: pesos(3_200n).toString(),
    reason: "save_excess",
    status: intentStatus,
    createdAt: new Date(NOW.getTime() - HOUR),
  });
const countedTrade = (userId: string, cents: number, createdAt = new Date(NOW.getTime() - HOUR)) =>
  db.insert(fxTrades).values({
    userId,
    sellAsset: "WARS",
    buyAsset: "USDT",
    sellAmount: "1",
    notionalUsdCents: cents,
    status: "filled",
    createdAt,
  });
/** Silences and records console.error, for the tests that fail on purpose. */
const logged = () => vi.spyOn(console, "error").mockImplementation(() => {});

/** Makes one type of agent event fail to insert, so the transaction that writes it fails. */
async function withFailingEvent(type: string, run: () => Promise<void>) {
  await db.execute(
    sql.raw(`CREATE OR REPLACE FUNCTION fail_event() RETURNS trigger AS $$ BEGIN IF NEW.type = '${type}' THEN RAISE EXCEPTION 'event insert failed'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`),
  );
  await db.execute(sql`CREATE TRIGGER fail_event BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION fail_event()`);
  try {
    await run();
  } finally {
    await db.execute(sql`DROP TRIGGER fail_event ON agent_events`);
  }
}

describe("chatSwap", () => {
  it("swaps, stores the card id, and reports success", async () => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, SELL);

    expect(state.sent).toEqual([rawOf(1)]);
    const [trade] = await tradesOf(user.id);
    expect(trade).toMatchObject({ chatCardId: CARD, intentId: null, status: "filled", swapTxHash: hashOf(1) });
    expect(await refusals(user.id)).toEqual([]);
    expect(await status(user.id)).toEqual<ChatSwapStatus>({
      state: "success",
      soldAtomic: pesos(3_200n).toString(),
      boughtAtomic: "1990000",
      from: "WARS",
      to: "USDT",
      txHash: hashOf(1),
      turnedOff: false,
    });
    const converted = (await eventsOf(user.id)).find((e) => e.type === "converted");
    expect(converted?.data.reason).toBe("chat");
    expect(deps.rfq.submit).toHaveBeenCalledWith("rfq_1", "claim_1", hashOf(1));
    expect(deps.rfq.request).toHaveBeenCalledWith(
      expect.objectContaining({ sellToken: TOKENS.WARS.address, buyToken: TOKENS.USDT.address, sellAmount: pesos(3_200n), taker: TREASURY }),
    );
    expect(await walletHolder(user.id)).toBeNull();
  });

  it("works while auto-convert is off", async () => {
    const user = await seed();
    const off = new Date(NOW.getTime() - HOUR);
    await setRules(user.id, { autoPausedAt: off });
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, SELL);
    expect((await tradesOf(user.id))[0].status).toBe("filled");
    expect(await autoPausedAt(user.id)).toEqual(off);
  });

  it.each([
    ["Paused", "paused", (deps: ExecutorDeps) => deps, true],
    ["global off", "disabled", (deps: ExecutorDeps) => ({ ...deps, flags: { enabled: false, dryRun: false } }), false],
    ["dry run", "dry_run", (deps: ExecutorDeps) => ({ ...deps, flags: { enabled: true, dryRun: true } }), false],
  ] as const)("refuses while %s, signs nothing and records the refusal", async (_label, error, adjust, paused) => {
    const user = await seed();
    if (paused) await setRules(user.id, { enabled: false });
    const { deps, state } = harness(SELL_BALANCES);
    await chatSwap(adjust(deps), user.id, SELL);

    expect(deps.rfq.request).not.toHaveBeenCalled();
    expect(deps.signTx).not.toHaveBeenCalled();
    expect(state.sent).toEqual([]);
    const [event] = (await eventsOf(user.id)).filter((e) => e.type === "chat_swap_refused");
    expect(event.data).toEqual({ cardId: CARD, error, from: "WARS", to: "USDT", amount: pesos(3_200n).toString() });
    expect(await status(user.id)).toEqual({ state: "refused", error });
  });

  it("refuses not_ready when the wallet is not ready", async () => {
    const user = await seedFreelancer(db, { treasuryAddress: null });
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, SELL);
    expect(await refusals(user.id)).toEqual(["not_ready"]);
  });

  it("answers busy when another run holds the lock, and sends no RFQ", async () => {
    const user = await seed();
    await acquireWalletLock(db, await walletOf(user.id), OTHER_CARD, NOW);
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, SELL);
    expect(await refusals(user.id)).toEqual(["busy"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
    expect(await walletHolder(user.id)).toBe(OTHER_CARD);
  });

  it("stays silent on a double tap, while the card's own run holds the lock", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    let during: ChatSwapStatus | null = null;
    vi.mocked(deps.rfq.request).mockImplementationOnce(async () => {
      await chatSwap(deps, user.id, SELL);
      during = await status(user.id);
      return quoted();
    });
    await chatSwap(deps, user.id, SELL);

    expect(during).toEqual({ state: "running", stage: "price" });
    expect(await refusals(user.id)).toEqual([]);
    expect(deps.rfq.request).toHaveBeenCalledTimes(1);
    expect(await tradesOf(user.id)).toHaveLength(1);
    expect((await status(user.id)).state).toBe("success");
  });

  /** Runs a second tap on the same card during the first run's RFQ, and checks the first run is not disturbed. */
  async function secondTapDuringRfq(userId: string, deps: ExecutorDeps, secondTap: () => Promise<void>) {
    let during: ChatSwapStatus | null = null;
    let refusedDuring: unknown[] = [];
    vi.mocked(deps.rfq.request).mockImplementationOnce(async () => {
      await secondTap();
      during = await status(userId);
      refusedDuring = await refusals(userId);
      return quoted();
    });
    await chatSwap(deps, userId, SELL);

    expect(during).toEqual({ state: "running", stage: "price" });
    expect(refusedDuring).toEqual([]);
    expect(await refusals(userId)).toEqual([]);
    expect(deps.rfq.request).toHaveBeenCalledTimes(1);
    const trades = await tradesOf(userId);
    expect(trades).toHaveLength(1);
    expect(trades[0].status).toBe("filled");
    expect((await status(userId)).state).toBe("success");
  }

  it("records no refusal when the agent is paused and the running card is tapped again", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    await secondTapDuringRfq(user.id, deps, async () => {
      await setRules(user.id, { enabled: false });
      await chatSwap(deps, user.id, SELL);
    });
  });

  it.each([
    ["global off", { enabled: false, dryRun: false }],
    ["dry run", { enabled: true, dryRun: true }],
  ] as const)("records no refusal when the running card is tapped again under %s", async (_label, flags) => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    await secondTapDuringRfq(user.id, deps, () => chatSwap({ ...deps, flags }, user.id, SELL));
  });

  /** Throws on the first call only: the tap fails at taking the lock, and the database still answers afterwards. */
  const nowThrowingOnce = () => {
    let thrown = false;
    return () => {
      if (thrown) return NOW;
      thrown = true;
      throw new Error("query failed, said 0xSECRET");
    };
  };

  it("records no refusal when a second tap on the running card throws before the lock", async () => {
    const user = await seed();
    const errors = logged();
    const { deps } = harness(SELL_BALANCES);
    await secondTapDuringRfq(user.id, deps, () => chatSwap({ ...deps, now: nowThrowingOnce() }, user.id, SELL));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("0xSECRET");
  });

  it("refuses with unconfirmed when a lone tap throws before the lock, and sends no RFQ", async () => {
    const user = await seed();
    logged();
    const { deps } = harness(SELL_BALANCES);
    await expect(chatSwap({ ...deps, now: nowThrowingOnce() }, user.id, SELL)).resolves.toBeUndefined();
    expect(await refusals(user.id)).toEqual(["unconfirmed"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
    expect(deps.rfq.cancel).not.toHaveBeenCalled();
  });

  it("adds no refusal when a replay of a finished card throws before the lock", async () => {
    const user = await seed();
    logged();
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, SELL);
    await chatSwap({ ...deps, now: nowThrowingOnce() }, user.id, SELL);
    expect(await refusals(user.id)).toEqual([]);
    expect((await status(user.id)).state).toBe("success");
  });

  it("does not throw when a tap fails before the lock and the refusal cannot be written", async () => {
    const user = await seed();
    logged();
    const { deps } = harness(SELL_BALANCES);
    await withFailingEvent("chat_swap_refused", async () => {
      await expect(chatSwap({ ...deps, now: nowThrowingOnce() }, user.id, SELL)).resolves.toBeUndefined();
    });
    expect(await refusals(user.id)).toEqual([]);
  });

  it("answers busy while an earlier transaction is still pending", async () => {
    const user = await seed();
    await recordTreasuryTx(db, { userId: user.id, kind: "withdraw", nonce: 1, hash: hashOf(99), raw: rawOf(1), feeToken: "USDT" });
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, SELL);
    expect(await refusals(user.id)).toEqual(["busy"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });

  it("refuses a pair chat does not swap directly", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, { ...SELL, to: "WBRL" });
    expect(await refusals(user.id)).toEqual(["unsupported_pair"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });

  it("trades once for one card id, across a replay", async () => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, SELL);
    await chatSwap(deps, user.id, SELL);
    expect(deps.rfq.request).toHaveBeenCalledTimes(1);
    expect(state.sent).toHaveLength(1);
    expect(await tradesOf(user.id)).toHaveLength(1);
    expect(await refusals(user.id)).toEqual([]);
  });

  it("adds no refusal when a finished card is replayed after the agent is paused or the wallet is busy", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, SELL);

    await setRules(user.id, { enabled: false });
    await chatSwap(deps, user.id, SELL);
    await setRules(user.id, { enabled: true });
    await acquireWalletLock(db, await walletOf(user.id), OTHER_CARD, NOW);
    await chatSwap(deps, user.id, SELL);

    expect(await refusals(user.id)).toEqual([]);
    expect((await status(user.id)).state).toBe("success");
  });

  it("refuses more than the balance, and more than the daily limit, without an RFQ", async () => {
    const user = await seed();
    const poor = harness({ WARS: pesos(3_199n), USDT: 1_000_000n });
    await chatSwap(poor.deps, user.id, SELL);
    expect(await refusals(user.id)).toEqual(["insufficient"]);
    expect(poor.deps.rfq.request).not.toHaveBeenCalled();

    await setRules(user.id, { dailyMaxUsd: 1 });
    const capped = harness(SELL_BALANCES);
    await chatSwap(capped.deps, user.id, { ...SELL, cardId: OTHER_CARD });
    expect(await refusals(user.id)).toEqual(["insufficient", "daily_limit"]);
    expect(capped.deps.rfq.request).not.toHaveBeenCalled();
  });

  it("holds back the gas reserve when the sold token also pays for gas", async () => {
    const user = await seed();
    const { deps } = harness({ USDT: 2_000_000n }, buyQuote());
    await chatSwap(deps, user.id, BUY);
    expect(await refusals(user.id)).toEqual(["insufficient"]);
  });

  it("refuses under US$1 without an RFQ", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, { ...SELL, amount: pesos(1_599n) });
    expect(await refusals(user.id)).toEqual(["below_minimum"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });

  it("answers no_quote when the rates cannot be read", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    deps.rates = async () => {
      throw new Error("rates down");
    };
    await chatSwap(deps, user.id, SELL);
    expect(await refusals(user.id)).toEqual(["no_quote"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });

  it("answers needs_gas when no token can pay for gas and the drip does not help", async () => {
    const user = await seed();
    const { deps } = harness({ WARS: pesos(3_200n) });
    await chatSwap(deps, user.id, SELL);
    expect(deps.drip).toHaveBeenCalledTimes(1);
    expect(await refusals(user.id)).toEqual(["needs_gas"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });

  it("shares the daily limit with automatic swaps", async () => {
    const user = await seed();
    await countedTrade(user.id, 19_900); // US$199 of the default US$200 is gone
    const refused = harness(SELL_BALANCES);
    await chatSwap(refused.deps, user.id, SELL);
    expect(await refusals(user.id)).toEqual(["daily_limit"]);
    expect(refused.deps.rfq.request).not.toHaveBeenCalled();

    await db.delete(fxTrades).where(eq(fxTrades.userId, user.id));
    await countedTrade(user.id, 19_800); // exactly US$2 left
    const allowed = harness(SELL_BALANCES);
    await chatSwap(allowed.deps, user.id, { ...SELL, cardId: OTHER_CARD });
    expect(await refusals(user.id)).toEqual(["daily_limit"]);
    expect(allowed.state.sent).toHaveLength(1);
  });

  it("ignores perTradeMaxUsd", async () => {
    const user = await seed();
    await setRules(user.id, { perTradeMaxUsd: 50, dailyMaxUsd: 1_000 });
    const amount = pesos(480_000n); // US$300
    const { deps } = harness(
      { WARS: amount, USDT: 1_000_000n },
      quoted({ sellAmount: amount, takerPays: amount, buyAmount: 298_500_000n }),
    );
    await chatSwap(deps, user.id, { ...SELL, amount });
    expect(deps.rfq.request).toHaveBeenCalledWith(expect.objectContaining({ sellAmount: amount }));
    const [trade] = await tradesOf(user.id);
    expect(trade).toMatchObject({ status: "filled", notionalUsdCents: 30_000 });
  });

  it("refuses a quote off policy", async () => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES, quoted({ takerPays: pesos(3_201n) }));
    await chatSwap(deps, user.id, SELL);
    expect(await refusals(user.id)).toEqual(["policy"]);
    expect(await eventTypes(user.id)).toContain("policy_rejected");
    expect(deps.rfq.cancel).toHaveBeenCalledWith("rfq_1", "claim_1");
    expect(state.sent).toEqual([]);
  });

  it("refuses a price above maxSlippageBps at once, even for an old card", async () => {
    const user = await seed();
    // With no wait left, the agent's rule would accept this price, up to the hard limit. Chat does not.
    await setRules(user.id, { maxWaitMinutes: 0 });
    const { deps, state } = harness(SELL_BALANCES, quoted({ buyAmount: 1_989_000n }));
    await chatSwap(deps, user.id, SELL);

    expect(await refusals(user.id)).toEqual(["price"]);
    expect(deps.rfq.cancel).toHaveBeenCalledWith("rfq_1", "claim_1");
    expect(deps.signTx).not.toHaveBeenCalled();
    expect(state.sent).toEqual([]);
    const [trade] = await tradesOf(user.id);
    expect(trade).toMatchObject({ status: "rejected", detail: "price", chatCardId: CARD, slippageBps: 55 });
  });

  it("refuses with `changed` and cancels the quote when the swap now needs consent", async () => {
    const user = await seed();
    const { deps, state } = harness(BUY_BALANCES, buyQuote());
    await chatSwap(deps, user.id, { ...BUY, seenTurnsOff: false });

    expect(await refusals(user.id)).toEqual(["changed"]);
    expect(deps.rfq.cancel).toHaveBeenCalledWith("rfq_1", "claim_1");
    expect(deps.signTx).not.toHaveBeenCalled();
    expect(state.sent).toEqual([]);
    expect(await autoPausedAt(user.id)).toBeNull();
    expect((await tradesOf(user.id))[0]).toMatchObject({ status: "rejected", detail: "changed" });
  });

  it("does not need consent when auto-convert is already off", async () => {
    const user = await seed();
    const off = new Date(NOW.getTime() - HOUR);
    await setRules(user.id, { autoPausedAt: off });
    await openIntentRow(user.id);
    const { deps } = harness(BUY_BALANCES, buyQuote());
    await chatSwap(deps, user.id, { ...BUY, seenTurnsOff: false });

    expect((await tradesOf(user.id))[0].status).toBe("filled");
    expect(await autoPausedAt(user.id)).toEqual(off);
    expect(await eventTypes(user.id)).not.toContain("auto_convert_off");
    expect((await intentsOf(user.id))[0].status).toBe("waiting");
  });

  it("turns auto-convert off, cancels the open intent and logs the event only at broadcast", async () => {
    const user = await seed();
    await openIntentRow(user.id);
    const { deps } = harness(BUY_BALANCES, buyQuote());
    const seen: Record<string, unknown> = {};
    const { signTx, chain } = deps;
    const sendRaw = chain.sendRaw;
    deps.signTx = async (...args) => {
      seen.atSigning = await autoPausedAt(user.id);
      return signTx(...args);
    };
    deps.chain = {
      ...chain,
      sendRaw: async (raw) => {
        seen.atBroadcast = await autoPausedAt(user.id);
        seen.intentAtBroadcast = (await intentsOf(user.id))[0].status;
        seen.eventsAtBroadcast = await eventTypes(user.id);
        return sendRaw(raw);
      },
    };
    await chatSwap(deps, user.id, BUY);

    expect(seen.atSigning).toBeNull();
    expect(seen.atBroadcast).toEqual(NOW);
    expect(seen.intentAtBroadcast).toBe("cancelled");
    expect(seen.eventsAtBroadcast).toEqual(["auto_convert_off"]);
    const off = (await eventsOf(user.id)).find((e) => e.type === "auto_convert_off");
    expect(off?.data).toEqual({ cardId: CARD });
    expect(await status(user.id)).toMatchObject({ state: "success", turnedOff: true });
  });

  it.each([
    ["no quote", "no_quote", { status: "no_quote", reason: "no_valid_quote", retryAfterMs: null } as RfqOutcome, null],
    ["a price past the limit", "price", buyQuote({ buyAmount: pesos(3_100n) }), null],
    ["a reverted approval", "swap_failed", buyQuote(), "reverted"],
    ["a refused approval", "swap_failed", buyQuote(), "refused"],
    ["an approval with no receipt", "busy", buyQuote(), "pending"],
    ["an expired quote", "expired", buyQuote({ expiresAt: new Date(NOW.getTime() + 1_000) }), null],
  ] as const)("changes nothing on %s", async (_label, error, outcome, approval) => {
    const user = await seed();
    await openIntentRow(user.id);
    const { deps, state } = harness(BUY_BALANCES, outcome);
    if (approval) {
      logged();
      state.allowance = 0n;
      if (approval === "reverted") state.receipts.set(hashOf(1), "reverted");
      if (approval === "pending") state.receipts.set(hashOf(1), null);
      if (approval === "refused") state.refused.add(rawOf(1));
    }
    await chatSwap(deps, user.id, BUY);

    // A failed approval is told once, by the executor's swap_failed event.
    expect(await refusals(user.id)).toEqual(error === "swap_failed" ? [] : [error]);
    expect(await status(user.id)).toEqual({ state: "refused", error });
    expect(await autoPausedAt(user.id)).toBeNull();
    expect((await intentsOf(user.id))[0].status).toBe("waiting");
    expect(await eventTypes(user.id)).not.toContain("auto_convert_off");
    expect(await db.select().from(treasuryTxs).where(eq(treasuryTxs.kind, "swap"))).toEqual([]);
  });

  it("keeps auto-convert off when the broadcast later reverts", async () => {
    const user = await seed();
    const { deps, state } = harness(BUY_BALANCES, buyQuote());
    state.receipts.set(hashOf(1), "reverted");
    await chatSwap(deps, user.id, BUY);

    expect(await autoPausedAt(user.id)).toEqual(NOW);
    expect((await tradesOf(user.id))[0].status).toBe("failed");
    expect(await status(user.id)).toEqual({ state: "refused", error: "swap_failed" });
  });

  it("reports swap_failed when the node refuses the swap, and cancels the quote", async () => {
    const user = await seed();
    logged();
    const { deps, state } = harness(SELL_BALANCES);
    state.refused.add(rawOf(1));
    await chatSwap(deps, user.id, SELL);
    expect(await status(user.id)).toEqual({ state: "refused", error: "swap_failed" });
    expect(deps.rfq.cancel).toHaveBeenCalledWith("rfq_1", "claim_1");
  });

  it.each([
    ["a reverted swap", "failed", "reverted", (state: Harness["state"]) => state.receipts.set(hashOf(1), "reverted")],
    ["a swap the node refuses", "failed", "rejected", (state: Harness["state"]) => state.refused.add(rawOf(1))],
    ["a reverted approval", "rejected", "approve_reverted", (state: Harness["state"]) => {
      state.allowance = 0n;
      state.receipts.set(hashOf(1), "reverted");
    }],
    ["a refused approval", "rejected", "approve_rejected", (state: Harness["state"]) => {
      state.allowance = 0n;
      state.refused.add(rawOf(1));
    }],
  ] as const)("reports %s with one event, and status reads swap_failed", async (_label, tradeStatus, detail, fail) => {
    const user = await seed();
    logged();
    const { deps, state } = harness(SELL_BALANCES);
    fail(state);
    await chatSwap(deps, user.id, SELL);

    const told = (await eventTypes(user.id)).filter((type) => type === "swap_failed" || type === "chat_swap_refused");
    expect(told).toEqual(["swap_failed"]);
    expect((await tradesOf(user.id))[0]).toMatchObject({ status: tradeStatus, detail, chatCardId: CARD });
    expect(await status(user.id)).toEqual({ state: "refused", error: "swap_failed" });

    await chatSwap(deps, user.id, SELL);
    expect(deps.rfq.request).toHaveBeenCalledTimes(1);
    expect(await refusals(user.id)).toEqual([]);
  });

  it("reads an approval with no receipt as busy, not as a failed swap", async () => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES);
    state.allowance = 0n;
    state.receipts.set(hashOf(1), null);
    await chatSwap(deps, user.id, SELL);
    expect((await tradesOf(user.id))[0]).toMatchObject({ status: "rejected", detail: "approve_pending" });
    expect(await eventTypes(user.id)).toEqual(["chat_swap_refused"]);
    expect(await status(user.id)).toEqual({ state: "refused", error: "busy" });
  });

  it.each([
    ["with no reason", undefined, "http_429"],
    ["with a reason", "too_many_rfqs", "too_many_rfqs"],
  ] as const)("reads a Textile 429 %s as busy", async (_label, reason, detail) => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES);
    vi.mocked(deps.rfq.request).mockRejectedValueOnce(new TextileError(429, reason, "slow down"));
    await chatSwap(deps, user.id, SELL);

    expect(await refusals(user.id)).toEqual(["busy"]);
    expect(await status(user.id)).toEqual({ state: "refused", error: "busy" });
    expect((await tradesOf(user.id))[0]).toMatchObject({ status: "no_quote", detail, chatCardId: CARD });
    expect(state.sent).toEqual([]);
  });

  it("does not touch an open intent when auto-convert stays on", async () => {
    const user = await seed();
    await openIntentRow(user.id);
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, user.id, { ...SELL, seenTurnsOff: true });
    expect((await tradesOf(user.id))[0].status).toBe("filled");
    expect((await intentsOf(user.id))[0].status).toBe("waiting");
    expect(await autoPausedAt(user.id)).toBeNull();
    expect(await eventTypes(user.id)).not.toContain("auto_convert_off");
  });

  it("sends no second RFQ after a failure", async () => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES, { status: "no_quote", reason: "no_valid_quote", retryAfterMs: 1_000 });
    await chatSwap(deps, user.id, SELL);
    state.outcome = quoted();
    await chatSwap(deps, user.id, SELL);

    expect(deps.rfq.request).toHaveBeenCalledTimes(1);
    expect(state.sent).toEqual([]);
    expect(await refusals(user.id)).toEqual(["no_quote"]);
    const trades = await tradesOf(user.id);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ status: "no_quote", chatCardId: CARD, detail: "no_valid_quote" });
  });

  it("answers no_quote when Textile errors, leaving nothing a later run could execute", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    vi.mocked(deps.rfq.request).mockRejectedValueOnce(new TextileError(500, undefined, "down"));
    await chatSwap(deps, user.id, SELL);
    expect(await refusals(user.id)).toEqual(["no_quote"]);
    expect(await intentsOf(user.id)).toEqual([]);
  });

  it("leaves a swap with no receipt yet to reconciliation", async () => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES);
    state.receipts.set(hashOf(1), null);
    await chatSwap(deps, user.id, SELL);

    expect(await refusals(user.id)).toEqual([]);
    expect(await status(user.id)).toEqual({ state: "confirming" });
    expect(await activeChatCardId(db, user.id)).toBe(CARD);

    state.receipts.set(hashOf(1), "success");
    await reconcileWallets(deps);
    expect((await status(user.id)).state).toBe("success");
    expect(await activeChatCardId(db, user.id)).toBeNull();
    const converted = (await eventsOf(user.id)).find((e) => e.type === "converted");
    expect(converted?.data.reason).toBe("chat");
  });

  it("records unconfirmed instead of throwing when signing fails", async () => {
    const user = await seed();
    const errors = logged();
    const { deps, state } = harness(SELL_BALANCES);
    vi.mocked(deps.signTx).mockRejectedValueOnce(new Error("para said 0xSECRET"));
    await expect(chatSwap(deps, user.id, SELL)).resolves.toBeUndefined();

    expect(await refusals(user.id)).toEqual(["unconfirmed"]);
    expect(await status(user.id)).toEqual({ state: "refused", error: "unconfirmed" });
    expect(deps.rfq.cancel).toHaveBeenCalledWith("rfq_1", "claim_1");
    expect(state.sent).toEqual([]);
    expect(await tradesOf(user.id)).toEqual([]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("0xSECRET");
    expect(await walletHolder(user.id)).toBeNull();
  });

  it("cancels the quote when signing the approval fails", async () => {
    const user = await seed();
    logged();
    const { deps, state } = harness(SELL_BALANCES);
    state.allowance = 0n;
    vi.mocked(deps.signTx).mockRejectedValueOnce(new Error("para down"));
    await chatSwap(deps, user.id, SELL);
    expect(deps.rfq.cancel).toHaveBeenCalledWith("rfq_1", "claim_1");
    expect(await refusals(user.id)).toEqual(["unconfirmed"]);
  });

  it("only logs a failed cancel, and still refuses with unconfirmed", async () => {
    const user = await seed();
    const errors = logged();
    const { deps } = harness(SELL_BALANCES);
    vi.mocked(deps.signTx).mockRejectedValueOnce(new Error("para down"));
    vi.mocked(deps.rfq.cancel).mockRejectedValueOnce(new Error("cancel said 0xSECRET"));
    await expect(chatSwap(deps, user.id, SELL)).resolves.toBeUndefined();
    expect(await refusals(user.id)).toEqual(["unconfirmed"]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("0xSECRET");
  });

  it("rolls everything back, cancels the quote and refuses when beforeBroadcast fails", async () => {
    const user = await seed();
    logged();
    await openIntentRow(user.id);
    const { deps, state } = harness(BUY_BALANCES, buyQuote());
    await withFailingEvent("auto_convert_off", () => chatSwap(deps, user.id, BUY));

    expect(state.sent).toEqual([]);
    expect(deps.rfq.cancel).toHaveBeenCalledWith("rfq_1", "claim_1");
    expect(await refusals(user.id)).toEqual(["unconfirmed"]);
    expect(await tradesOf(user.id)).toEqual([]);
    expect(await db.select().from(treasuryTxs).where(eq(treasuryTxs.userId, user.id))).toEqual([]);
    expect(await autoPausedAt(user.id)).toBeNull();
    expect((await intentsOf(user.id))[0].status).toBe("waiting");

    await chatSwap(deps, user.id, BUY);
    expect(deps.rfq.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the broadcast has an unknown outcome", "send"],
    ["the wait for the receipt fails", "wait"],
  ] as const)("keeps the quote and says nothing was refused when %s", async (_label, step) => {
    const user = await seed();
    logged();
    const { deps, state } = harness(SELL_BALANCES);
    const { sendRaw, waitForReceipt } = deps.chain;
    deps.chain = {
      ...deps.chain,
      sendRaw: step === "send" ? vi.fn(async () => { throw new Error("connection reset"); }) : sendRaw,
      waitForReceipt: step === "wait" ? vi.fn(async () => { throw new Error("connection reset"); }) : waitForReceipt,
    };
    await expect(chatSwap(deps, user.id, SELL)).resolves.toBeUndefined();

    expect(deps.rfq.cancel).not.toHaveBeenCalled();
    expect(await refusals(user.id)).toEqual([]);
    expect(await status(user.id)).toEqual({ state: "confirming" });

    deps.chain = { ...deps.chain, sendRaw, waitForReceipt };
    state.receipts.set(hashOf(1), "success");
    await reconcileWallets(deps);
    expect((await status(user.id)).state).toBe("success");
    expect(deps.rfq.submit).toHaveBeenCalledWith("rfq_1", "claim_1", hashOf(1));
  });

  it("never throws, even when the refusal cannot be written", async () => {
    const user = await seed();
    logged();
    const { deps } = harness(SELL_BALANCES);
    vi.mocked(deps.signTx).mockRejectedValueOnce(new Error("para down"));
    await withFailingEvent("chat_swap_refused", async () => {
      await expect(chatSwap(deps, user.id, SELL)).resolves.toBeUndefined();
    });
    expect(await walletHolder(user.id)).toBeNull();
  });

  it("ignores a card id that is not a uuid, which must not reach Postgres", async () => {
    const user = await seed();
    const errors = logged();
    const { deps } = harness(SELL_BALANCES);
    await expect(chatSwap(deps, user.id, { ...SELL, cardId: "not-a-uuid" })).resolves.toBeUndefined();
    expect(deps.rfq.request).not.toHaveBeenCalled();
    expect(await eventsOf(user.id)).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});

describe("previewChatSwap", () => {
  const isCard = (reply: Awaited<ReturnType<typeof previewChatSwap>>): reply is SwapCard => "cardId" in reply;
  const card = async (reply: ReturnType<typeof previewChatSwap>) => {
    const value = await reply;
    if (!isCard(value)) throw new Error(`Expected a card, got ${JSON.stringify(value)}`);
    return value;
  };
  const SELL_ASK = { from: "WARS", to: "USDT", wanted: pesos(3_200n) } as const;
  const BUY_ASK = { from: "USDT", to: "WARS", wanted: 2_000_000n } as const;

  it("builds a card with the estimate and the auto-convert answer", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    const stays = await card(previewChatSwap(deps, user.id, SELL_ASK));
    expect(stays).toEqual<SwapCard>({
      cardId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      from: "WARS",
      to: "USDT",
      amountAtomic: pesos(3_200n).toString(),
      buyAtomic: "1990000",
      limited: null,
      turnsOff: false,
      losesProposal: false,
      nextDailyAt: null,
    });
    expect(deps.preview).toHaveBeenCalledWith({
      sellToken: TOKENS.WARS.address,
      buyToken: TOKENS.USDT.address,
      sellAmount: pesos(3_200n),
      taker: TREASURY,
    });

    const buying = harness(BUY_BALANCES);
    buying.state.preview = preview(pesos(3_184n), 2_000_000n);
    expect((await card(previewChatSwap(buying.deps, user.id, BUY_ASK))).turnsOff).toBe(true);
  });

  it("says nothing about auto-convert when it is already off", async () => {
    const user = await seed();
    await setRules(user.id, { autoPausedAt: NOW });
    await openIntentRow(user.id, "proposed");
    const { deps, state } = harness(BUY_BALANCES);
    state.preview = preview(pesos(3_184n), 2_000_000n);
    expect(await card(previewChatSwap(deps, user.id, BUY_ASK))).toMatchObject({ turnsOff: false, losesProposal: false });
  });

  it("lowers to the daily limit and says when more is available", async () => {
    const user = await seed();
    await setRules(user.id, { dailyMaxUsd: 3 });
    const oldest = new Date(NOW.getTime() - 2 * HOUR);
    await countedTrade(user.id, 50, oldest);
    await countedTrade(user.id, 50);
    const { deps } = harness({ WARS: pesos(8_000n), USDT: 1_000_000n });
    const lowered = await card(previewChatSwap(deps, user.id, { ...SELL_ASK, wanted: pesos(8_000n) }));
    expect(lowered).toMatchObject({
      amountAtomic: pesos(3_200n).toString(),
      limited: "daily",
      nextDailyAt: new Date(oldest.getTime() + 24 * HOUR).toISOString(),
    });
    expect(deps.preview).toHaveBeenCalledWith(expect.objectContaining({ sellAmount: pesos(3_200n) }));
  });

  it("refuses a used-up daily limit and says when more is available", async () => {
    const user = await seed();
    const oldest = new Date(NOW.getTime() - 2 * HOUR);
    await countedTrade(user.id, 20_000, oldest);
    const { deps } = harness(SELL_BALANCES);
    expect(await previewChatSwap(deps, user.id, SELL_ASK)).toEqual({
      refused: "daily_limit",
      availableSellAtomic: null,
      nextDailyAt: new Date(oldest.getTime() + 24 * HOUR).toISOString(),
    });
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it("lowers to the balance", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    expect(await card(previewChatSwap(deps, user.id, { ...SELL_ASK, wanted: pesos(4_000n) }))).toMatchObject({
      amountAtomic: pesos(3_200n).toString(),
      limited: "balance",
    });
  });

  it("flags a proposal that would be lost", async () => {
    const user = await seed();
    await openIntentRow(user.id, "proposed");
    const stays = harness(SELL_BALANCES);
    expect((await card(previewChatSwap(stays.deps, user.id, SELL_ASK))).losesProposal).toBe(false);

    const { deps, state } = harness(BUY_BALANCES);
    state.preview = preview(pesos(3_184n), 2_000_000n);
    expect(await card(previewChatSwap(deps, user.id, BUY_ASK))).toMatchObject({ turnsOff: true, losesProposal: true });
    // A preview changes nothing.
    expect((await intentsOf(user.id))[0].status).toBe("proposed");
    expect(await autoPausedAt(user.id)).toBeNull();
  });

  it("refuses with availableSellAtomic on no quote", async () => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES);
    state.preview = { status: "no_quote", reason: "no_valid_quote", availableSellAmount: pesos(1_600n) };
    expect(await previewChatSwap(deps, user.id, SELL_ASK)).toEqual({
      refused: "no_quote",
      availableSellAtomic: pesos(1_600n).toString(),
      nextDailyAt: null,
    });
    state.preview = { status: "no_quote", reason: "no_valid_quote", availableSellAmount: null };
    expect(await previewChatSwap(deps, user.id, SELL_ASK)).toEqual({ refused: "no_quote", availableSellAtomic: null, nextDailyAt: null });
  });

  it("answers no_quote when Textile errors or the rates cannot be read", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    const noQuote = { refused: "no_quote", availableSellAtomic: null, nextDailyAt: null };
    vi.mocked(deps.preview).mockRejectedValueOnce(new TextileError(500, undefined, "down"));
    expect(await previewChatSwap(deps, user.id, SELL_ASK)).toEqual(noQuote);
    deps.rates = async () => {
      throw new Error("rates down");
    };
    expect(await previewChatSwap(deps, user.id, SELL_ASK)).toEqual(noQuote);
  });

  it("sells the exact atomic balance when no amount is given", async () => {
    const user = await seed();
    const exact = pesos(3_201n) + 123_456_789_012_345_678n;
    const { deps } = harness({ WARS: exact, USDT: 1_000_000n });
    const reply = await card(previewChatSwap(deps, user.id, { from: "WARS", to: "USDT", wanted: null }));
    expect(reply.amountAtomic).toBe(exact.toString());
    expect(deps.preview).toHaveBeenCalledWith(expect.objectContaining({ sellAmount: exact }));
  });

  it("refuses while Paused, without a wallet, or on an indirect pair", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    expect(await previewChatSwap(deps, user.id, { ...SELL_ASK, to: "WBRL" })).toMatchObject({ refused: "unsupported_pair" });
    await setRules(user.id, { enabled: false });
    expect(await previewChatSwap(deps, user.id, SELL_ASK)).toMatchObject({ refused: "paused" });
    const waiting = await seedFreelancer(db, { treasuryAddress: null });
    expect(await previewChatSwap(deps, waiting.id, SELL_ASK)).toMatchObject({ refused: "not_ready" });
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it("refuses under the minimum and with an empty balance", async () => {
    const user = await seed();
    const { deps } = harness(SELL_BALANCES);
    expect(await previewChatSwap(deps, user.id, { ...SELL_ASK, wanted: pesos(100n) })).toMatchObject({ refused: "below_minimum" });
    const empty = harness({ USDT: 1_000_000n });
    expect(await previewChatSwap(empty.deps, user.id, SELL_ASK)).toMatchObject({ refused: "insufficient" });
  });
});

describe("chatSwapStatus", () => {
  it("reads running stages from the lock, a pending approval and the trade", async () => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES);
    state.allowance = 0n;
    const stages: ChatSwapStatus[] = [];
    const { waitForReceipt } = deps.chain;
    vi.mocked(deps.rfq.request).mockImplementationOnce(async () => {
      stages.push(await status(user.id));
      return quoted();
    });
    deps.chain = {
      ...deps.chain,
      waitForReceipt: async (hash) => {
        stages.push(await status(user.id));
        return waitForReceipt(hash);
      },
    };
    await chatSwap(deps, user.id, SELL);
    expect(stages).toEqual([
      { state: "running", stage: "price" },
      { state: "running", stage: "preparing" },
      { state: "running", stage: "swapping" },
    ]);
  });

  it("reads confirming when the lock is gone and the trade is broadcast", async () => {
    const user = await seed();
    const { deps, state } = harness(SELL_BALANCES);
    state.receipts.set(hashOf(1), null);
    await chatSwap(deps, user.id, SELL);
    expect(await status(user.id)).toEqual({ state: "confirming" });
  });

  it("reads success with amounts, refused with the error, and unknown otherwise", async () => {
    const user = await seed();
    expect(await status(user.id)).toEqual({ state: "unknown" });
    expect(await chatSwapStatus(db, user.id, "not-a-uuid", NOW)).toEqual({ state: "unknown" });

    const refused = harness(SELL_BALANCES, { status: "no_quote", reason: "no_valid_quote", retryAfterMs: null });
    await chatSwap(refused.deps, user.id, SELL);
    expect(await status(user.id)).toEqual({ state: "refused", error: "no_quote" });

    const done = harness(SELL_BALANCES);
    await chatSwap(done.deps, user.id, { ...SELL, cardId: OTHER_CARD });
    expect(await status(user.id, OTHER_CARD)).toMatchObject({ state: "success", boughtAtomic: "1990000", turnedOff: false });
  });

  it("reads unknown once a dead run's lock has expired", async () => {
    const user = await seed();
    await acquireWalletLock(db, await walletOf(user.id), CARD, NOW);
    expect(await status(user.id)).toEqual({ state: "running", stage: "price" });
    expect(await status(user.id, CARD, new Date(NOW.getTime() + 6 * 60_000))).toEqual({ state: "unknown" });
  });

  it("does not read another user's card", async () => {
    const owner = await seed();
    const stranger = await seed();
    const { deps } = harness(SELL_BALANCES);
    await chatSwap(deps, owner.id, SELL);
    expect(await status(stranger.id)).toEqual({ state: "unknown" });

    const refused = harness(SELL_BALANCES, { status: "no_quote", reason: "x", retryAfterMs: null });
    await chatSwap(refused.deps, owner.id, { ...SELL, cardId: OTHER_CARD });
    expect(await status(stranger.id, OTHER_CARD)).toEqual({ state: "unknown" });
  });
});

describe("activeChatCardId", () => {
  it("names only a chat trade still broadcast, and only for its owner", async () => {
    const user = await seed();
    const stranger = await seed();
    await db.insert(fxTrades).values({ userId: user.id, sellAsset: "WARS", buyAsset: "USDT", sellAmount: "1", status: "broadcast" });
    expect(await activeChatCardId(db, user.id)).toBeNull();

    const { deps, state } = harness(SELL_BALANCES);
    state.receipts.set(hashOf(1), null);
    await chatSwap(deps, user.id, SELL);
    expect(await activeChatCardId(db, user.id)).toBe(CARD);
    expect(await activeChatCardId(db, stranger.id)).toBeNull();
  });

  it("names the card holding the wallet lock before anything is broadcast", async () => {
    const user = await seed();
    const stranger = await seed();
    await acquireWalletLock(db, await walletOf(user.id), CARD, NOW);
    expect(await activeChatCardId(db, user.id, NOW)).toBe(CARD);
    expect(await activeChatCardId(db, stranger.id, NOW)).toBeNull();
  });

  it("never names a card that has ended but still holds the lock, so its result is not shown twice", async () => {
    const user = await seed();
    const wallet = await walletOf(user.id);
    await acquireWalletLock(db, wallet, CARD, NOW);
    expect(await activeChatCardId(db, user.id, NOW)).toBe(CARD);

    await db.insert(fxTrades).values({
      userId: user.id,
      sellAsset: "WARS",
      buyAsset: "USDT",
      sellAmount: "1",
      buyAmount: "1",
      swapTxHash: hashOf(1),
      status: "filled",
      chatCardId: CARD,
    });
    expect(await activeChatCardId(db, user.id, NOW)).toBeNull();
    await db.delete(fxTrades);

    await db.insert(agentEvents).values({
      userId: user.id,
      type: "chat_swap_refused",
      data: { cardId: CARD, error: "no_quote", from: "WARS", to: "USDT", amount: "1" },
      createdAt: NOW,
    });
    expect(await activeChatCardId(db, user.id, NOW)).toBeNull();
  });

  it("still names a broadcast trade", async () => {
    const user = await seed();
    await db.insert(fxTrades).values({ userId: user.id, sellAsset: "WARS", buyAsset: "USDT", sellAmount: "1", status: "broadcast", chatCardId: CARD });
    expect(await activeChatCardId(db, user.id, NOW)).toBe(CARD);
  });

  it("names nothing for a lock held by the agent or a withdrawal, or for an expired lock", async () => {
    const user = await seed();
    const wallet = await walletOf(user.id);
    await acquireWalletLock(db, wallet, runHolder(), NOW);
    expect(await activeChatCardId(db, user.id, NOW)).toBeNull();
    await releaseWalletLock(db, wallet, (await walletLockHolder(db, wallet)) as string);
    await acquireWalletLock(db, wallet, CARD, NOW);
    expect(await activeChatCardId(db, user.id, new Date(NOW.getTime() + 60 * 60 * 1000))).toBeNull();
  });
});

describe("setAutoConvertOn", () => {
  it("clears the state and logs the event once", async () => {
    const user = await seed();
    await setRules(user.id, { autoPausedAt: NOW });
    await setAutoConvertOn(db, user.id, NOW);
    await setAutoConvertOn(db, user.id, NOW);
    expect(await autoPausedAt(user.id)).toBeNull();
    expect(await eventTypes(user.id)).toEqual(["auto_convert_on"]);
  });
});

describe("nextDailyCapacityAt", () => {
  it("is the oldest counted trade in the window plus 24 hours, or null", async () => {
    const user = await seed();
    expect(await nextDailyCapacityAt(db, user.id, NOW)).toBeNull();

    await countedTrade(user.id, 100, new Date(NOW.getTime() - 25 * HOUR)); // left the window
    await db.insert(fxTrades).values({
      userId: user.id,
      sellAsset: "WARS",
      buyAsset: "USDT",
      sellAmount: "1",
      status: "rejected",
      createdAt: new Date(NOW.getTime() - 20 * HOUR),
    }); // never counted
    await countedTrade(user.id, 100, new Date(NOW.getTime() - HOUR));
    await countedTrade(user.id, 100, new Date(NOW.getTime() - 3 * HOUR));
    expect(await nextDailyCapacityAt(db, user.id, NOW)).toEqual(new Date(NOW.getTime() + 21 * HOUR));
  });
});
