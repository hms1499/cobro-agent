// src/lib/treasury/executor.test.ts
import { eq } from "drizzle-orm";
import { decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { TEXTILE_REACTOR, type GasToken } from "@/lib/chain/treasury-tx";
import type { Db } from "@/lib/db/client";
import { agentEvents, fxIntents, fxTrades, rules, treasuryTxs, treasuryWallets } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import type { ReferenceRates } from "@/lib/fx/rates";
import { TextileError, type FirmQuote, type RfqOutcome } from "@/lib/fx/rfq";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { engineInput, runTreasuries, runTreasuryForUser, summarizeRuns, type ExecutorDeps } from "./executor";
import { acquireWalletLock, loadTreasuryContext } from "./repo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const pesos = (n: bigint) => n * 10n ** 18n;
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };
const TREASURY = getAddress(TEST_TREASURY);
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const hashOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

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

/** The real database around a fake chain, signer, Textile and drip. Signed transaction n has hash hashOf(n). */
function harness(balances: Partial<TreasuryBalances>, over: { dryRun?: boolean; outcome?: RfqOutcome } = {}) {
  const state = {
    balances: { ...ZERO, ...balances },
    allowance: 0n,
    receipts: new Map<string, "success" | "reverted" | null>(),
    confirmedNonce: 0,
    sent: [] as Hex[],
  };
  const signed: { to: Address; data: Hex; feeToken: GasToken }[] = [];
  const deps: ExecutorDeps = {
    db,
    now: () => NOW,
    flags: { enabled: true, dryRun: over.dryRun ?? false },
    rates: async () => RATES,
    chain: {
      readBalances: async () => ({ ...state.balances }),
      allowance: async () => state.allowance,
      receipt: async (hash) => state.receipts.get(hash) ?? null,
      confirmedNonce: async () => state.confirmedNonce,
      sendRaw: async (raw) => {
        state.sent.push(raw);
      },
      waitForReceipt: async (hash) => (state.receipts.has(hash) ? (state.receipts.get(hash) ?? null) : "success"),
    },
    signer: () => ({ address: TREASURY, signDigest: vi.fn(), signTypedData: vi.fn(async () => "0x5151" as Hex) }),
    signTx: vi.fn<ExecutorDeps["signTx"]>(async (...args) => {
      const [, call, feeToken] = args;
      signed.push({ ...call, feeToken });
      const n = signed.length;
      return { hash: hashOf(n), raw: `0x${"ab".repeat(n)}` as Hex, nonce: n, feeToken };
    }),
    rfq: {
      request: vi.fn(async () => over.outcome ?? quoted()),
      cancel: vi.fn(async () => {}),
      submit: vi.fn(async () => {}),
    },
    drip: vi.fn(async () => {
      state.balances.USDC = 50_000n;
      return "0xd1" as Hex;
    }),
    allowedSpenders: [TEXTILE_REACTOR],
  };
  return { deps, state, signed };
}

async function freelancer(reserveAmount = "0.00") {
  const user = await seedFreelancer(db);
  await db.update(rules).set({ reserveAmount }).where(eq(rules.userId, user.id));
  return user;
}
const eventTypes = async (userId: string) =>
  (await db.select().from(agentEvents).where(eq(agentEvents.userId, userId))).map((e) => e.type);
const tradesOf = (userId: string) => db.select().from(fxTrades).where(eq(fxTrades.userId, userId));
const intentsOf = (userId: string) => db.select().from(fxIntents).where(eq(fxIntents.userId, userId));
const gas = { USDT: 1_000_000n };

describe("runTreasuryForUser: switches and dry run", () => {
  it("does nothing while the global switch is off", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas });
    deps.flags.enabled = false;
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "disabled" });
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });

  it("records a dry-run decision once and contacts nobody", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas }, { dryRun: true });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("dry_run");
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("dry_run");
    expect(await eventTypes(user.id)).toEqual(["dry_run"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
    expect(deps.signTx).not.toHaveBeenCalled();
  });

  it("leaves no open intent behind in dry run, so nothing ages toward the wait deadline", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas }, { dryRun: true });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("dry_run");
    expect(await intentsOf(user.id)).toEqual([]);
  });

  it.each([
    ["the same pair", "USDT"],
    ["another pair", "USAT"],
  ] as const)("cancels an open intent for %s in dry run", async (_label, toAsset) => {
    const user = await freelancer();
    await db.insert(fxIntents).values({
      userId: user.id,
      fromAsset: "WARS",
      toAsset,
      amountAtomic: pesos(3_200n).toString(),
      reason: "save_excess",
      createdAt: new Date(NOW.getTime() - 3 * 24 * 3_600_000),
    });
    const { deps } = harness({ WARS: pesos(3_200n), ...gas }, { dryRun: true });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("dry_run");
    expect((await intentsOf(user.id)).map((i) => i.status)).toEqual(["cancelled"]);
  });

  it("records a new dry-run event when the decision changes", async () => {
    const user = await freelancer();
    const { deps, state } = harness({ WARS: pesos(3_200n), ...gas }, { dryRun: true });
    await runTreasuryForUser(deps, user.id);
    // Paid in reais now: the decision becomes "save the other currency" (another pair and reason).
    state.balances.WBRL = pesos(10n);
    // Each cron run happens later than the one before; the last event is the newest one.
    deps.now = () => new Date(NOW.getTime() + 600_000);
    await runTreasuryForUser(deps, user.id);
    deps.now = () => new Date(NOW.getTime() + 1_200_000);
    await runTreasuryForUser(deps, user.id);
    const events = await db.select().from(agentEvents).where(eq(agentEvents.userId, user.id)).orderBy(agentEvents.createdAt);
    expect(events.map((e) => [e.type, e.data.from, e.data.reason, e.data.amount])).toEqual([
      ["dry_run", "WARS", "save_excess", pesos(3_200n).toString()],
      ["dry_run", "WBRL", "save_other", pesos(10n).toString()],
    ]);
  });

  it("records one dry-run event while only the rates move", async () => {
    const user = await freelancer();
    // US$100 of wARS, capped at US$50 a trade: the amount sold and its dollar value both follow the rate.
    const { deps } = harness({ WARS: pesos(160_000n), ...gas }, { dryRun: true });
    await runTreasuryForUser(deps, user.id);
    deps.rates = async () => ({ ...RATES, perUsd: { ...RATES.perUsd, ARS: parseDecimal("1450", 18) } });
    deps.now = () => new Date(NOW.getTime() + 600_000);
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("dry_run");
    const events = await db.select().from(agentEvents).where(eq(agentEvents.userId, user.id));
    expect(events.map((e) => [e.type, e.data.from, e.data.to, e.data.reason, e.data.amount, e.data.usdCents])).toEqual([
      ["dry_run", "WARS", "USDT", "save_excess", pesos(80_000n).toString(), 5_000],
    ]);
  });

  it("returns locked while another run holds the wallet", async () => {
    const user = await freelancer();
    const [wallet] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, user.id));
    await acquireWalletLock(db, wallet.id, crypto.randomUUID(), NOW);
    const { deps } = harness({ WARS: pesos(3_200n), ...gas });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("locked");
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });
});

describe("runTreasuryForUser: converting", () => {
  it("approves the reactor, swaps, records the fill and tells Textile", async () => {
    const user = await freelancer();
    const { deps, signed } = harness({ WARS: pesos(3_200n), ...gas });

    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "converted" });

    expect(deps.rfq.request).toHaveBeenCalledWith(
      expect.objectContaining({ sellAmount: pesos(3_200n), taker: TREASURY, takerProof: expect.objectContaining({ signature: "0x5151" }) }),
    );
    // Approval up to the rest of the daily cap (US$200 = 320,000 wARS), then the quote's swap.
    expect(signed[0].to).toBe(TOKENS.WARS.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: signed[0].data }).args).toEqual([TEXTILE_REACTOR, pesos(320_000n)]);
    expect(signed[1]).toEqual({ to: TEXTILE_REACTOR, data: "0xabcdef", feeToken: "USDT" });

    const [trade] = await tradesOf(user.id);
    expect(trade).toMatchObject({ status: "filled", slippageBps: 50, notionalUsdCents: 200, swapTxHash: hashOf(2) });
    expect((await intentsOf(user.id))[0].status).toBe("filled");
    expect(deps.rfq.submit).toHaveBeenCalledWith("rfq_1", "claim_1", hashOf(2));
    expect(await eventTypes(user.id)).toEqual(["converted"]);
    expect((await db.select().from(treasuryTxs)).map((t) => t.status)).toEqual(["success", "success"]);
  });

  it("resets a USD₮ allowance to 0 before raising it", async () => {
    // Reserve ARS 16,000 (US$10), nothing held: buy US$10 of wARS with USD₮.
    const user = await freelancer("16000.00");
    const { deps, state, signed } = harness(
      { USDT: 20_000_000n },
      { outcome: quoted({ sellAmount: 10_000_000n, takerPays: 10_000_000n, buyAmount: pesos(15_950n) }) },
    );
    state.allowance = 5n;
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("converted");
    expect(decodeFunctionData({ abi: erc20Abi, data: signed[0].data }).args).toEqual([TEXTILE_REACTOR, 0n]);
    expect(decodeFunctionData({ abi: erc20Abi, data: signed[1].data }).args).toEqual([TEXTILE_REACTOR, 200_000_000n]);
    expect(signed[2].to).toBe(TEXTILE_REACTOR);
  });

  it("drips gas once when the wallet has no stablecoin to pay with", async () => {
    const user = await freelancer();
    const { deps, signed } = harness({ WARS: pesos(3_200n) });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("converted");
    expect(deps.drip).toHaveBeenCalledWith(TREASURY, 50_000n);
    expect(signed.every((s) => s.feeToken === "USDC")).toBe(true);
    expect(await eventTypes(user.id)).toEqual(["gas_dripped", "converted"]);
  });

  it("waits without gas when today's drip was already used", async () => {
    const user = await freelancer();
    await db.update(treasuryWallets).set({ gasDrippedAt: new Date(NOW.getTime() - 3_600_000) }).where(eq(treasuryWallets.userId, user.id));
    const { deps } = harness({ WARS: pesos(3_200n) });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("needs_gas");
    expect(deps.drip).not.toHaveBeenCalled();
    expect(await eventTypes(user.id)).toEqual(["needs_gas"]);
  });

  it("keeps the day's drip claim and waits for gas when the drip fails", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n) });
    vi.mocked(deps.drip).mockRejectedValueOnce(new Error("operator out of gas"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("needs_gas");
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("drip"), expect.any(Error));
    } finally {
      logged.mockRestore();
    }
    expect(deps.signTx).not.toHaveBeenCalled();
    expect(await eventTypes(user.id)).toEqual(["needs_gas"]);
    const [wallet] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, user.id));
    expect(wallet.gasDrippedAt).toEqual(NOW);
  });

  it("discards a quote that expires before the swap could be sent", async () => {
    const user = await freelancer();
    const { deps, signed } = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted({ expiresAt: new Date(NOW.getTime() + 3_000) }) });
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("expired");
    expect(signed).toHaveLength(1); // the approval only
    expect((await tradesOf(user.id))[0].status).toBe("expired");
    expect((await intentsOf(user.id))[0].status).toBe("waiting");
  });
});

describe("runTreasuryForUser: price and quote checks", () => {
  it("waits for a better price and says so once", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted({ buyAmount: 1_900_000n }) });
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "waiting", detail: "price" });
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "waiting", detail: "price" });
    expect(deps.rfq.cancel).toHaveBeenCalledWith("rfq_1", "claim_1");
    expect(deps.signTx).not.toHaveBeenCalled();
    expect((await tradesOf(user.id)).map((t) => [t.status, t.slippageBps])).toEqual([
      ["rejected", 500],
      ["rejected", 500],
    ]);
    expect(await eventTypes(user.id)).toEqual(["waiting"]);
    expect((await intentsOf(user.id))[0]).toMatchObject({ status: "waiting", attempts: 2, lastSlippageBps: 500 });
  });

  it("after the wait deadline blocks a price beyond the hard limit and accepts one within it", async () => {
    const blockedUser = await freelancer();
    const okUser = await freelancer();
    const old = new Date(NOW.getTime() - 7 * 3_600_000);
    for (const userId of [blockedUser.id, okUser.id]) {
      await db.insert(fxIntents).values({
        userId,
        fromAsset: "WARS",
        toAsset: "USDT",
        amountAtomic: pesos(3_200n).toString(),
        reason: "save_excess",
        createdAt: old,
      });
    }
    const blocked = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted({ buyAmount: 1_900_000n }) });
    expect((await runTreasuryForUser(blocked.deps, blockedUser.id)).outcome).toBe("blocked");
    expect((await intentsOf(blockedUser.id))[0].status).toBe("blocked");
    expect(await eventTypes(blockedUser.id)).toEqual(["blocked"]);

    const ok = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted({ buyAmount: 1_980_000n }) });
    expect((await runTreasuryForUser(ok.deps, okUser.id)).outcome).toBe("converted");
  });

  it.each([
    ["another taker", { taker: STRANGER }],
    ["an unknown spender", { spender: STRANGER, swap: { to: STRANGER, data: "0xabcdef" as Hex, value: 0n, chainId: 42220 } }],
    ["more than the intent", { takerPays: pesos(3_201n) }],
    ["a swap on another contract than its spender", { swap: { to: STRANGER, data: "0xabcdef" as Hex, value: 0n, chainId: 42220 } }],
    ["a swap on another chain", { swap: { to: TEXTILE_REACTOR, data: "0xabcdef" as Hex, value: 0n, chainId: 1 } }],
    ["a swap carrying value", { swap: { to: TEXTILE_REACTOR, data: "0xabcdef" as Hex, value: 1n, chainId: 42220 } }],
  ])("refuses a quote with %s and signs nothing", async (_label, over) => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas }, { outcome: quoted(over) });
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "failed", detail: "policy" });
    expect(deps.signTx).not.toHaveBeenCalled();
    expect(deps.rfq.cancel).toHaveBeenCalled();
    expect(await eventTypes(user.id)).toEqual(["policy_rejected"]);
  });

  it("respects Textile's retry hint after a no-quote", async () => {
    const user = await freelancer();
    const { deps } = harness(
      { WARS: pesos(3_200n), ...gas },
      { outcome: { status: "no_quote", reason: "no_makers_online", retryAfterMs: 30_000 } },
    );
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "no_quote", detail: "no_makers_online" });
    expect((await intentsOf(user.id))[0].retryAfter).toEqual(new Date(NOW.getTime() + 30_000));
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "waiting", detail: "retry_after" });
    expect(deps.rfq.request).toHaveBeenCalledTimes(1);
    expect((await tradesOf(user.id))[0]).toMatchObject({ status: "no_quote", detail: "no_makers_online" });
  });

  it("backs off after a Textile error such as insufficient funds", async () => {
    const user = await freelancer();
    const { deps } = harness({ WARS: pesos(3_200n), ...gas });
    vi.mocked(deps.rfq.request).mockRejectedValueOnce(new TextileError(400, "insufficient_funds", "not enough"));
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "no_quote", detail: "insufficient_funds" });
    expect((await intentsOf(user.id))[0].retryAfter).toEqual(new Date(NOW.getTime() + 600_000));
  });
});

describe("runTreasuryForUser: unknown outcomes (spec §10.4 step 7)", () => {
  async function pendingSwap(userId: string) {
    const [intent] = await db
      .insert(fxIntents)
      .values({ userId, fromAsset: "WARS", toAsset: "USDT", amountAtomic: "1", reason: "save_excess", status: "executing" })
      .returning();
    await db.insert(treasuryTxs).values({ userId, kind: "swap", nonce: 7, hash: hashOf(99), raw: "0xabab", feeToken: "USDT" });
    await db.insert(fxTrades).values({
      userId,
      intentId: intent.id,
      rfqId: "rfq_0",
      claimToken: "claim_0",
      sellAsset: "WARS",
      buyAsset: "USDT",
      sellAmount: "1",
      status: "broadcast",
      swapTxHash: hashOf(99),
    });
  }

  it("re-sends the stored bytes and does nothing else while a swap is unresolved", async () => {
    const user = await freelancer();
    await pendingSwap(user.id);
    const { deps, state } = harness({ WARS: pesos(3_200n), ...gas });
    state.confirmedNonce = 7;
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("pending_tx");
    expect(state.sent).toEqual(["0xabab"]);
    expect(deps.rfq.request).not.toHaveBeenCalled();
  });

  it("settles a swap from its receipt, then carries on", async () => {
    const user = await freelancer();
    await pendingSwap(user.id);
    const { deps, state } = harness({});
    state.receipts.set(hashOf(99), "success");
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("idle");
    expect((await tradesOf(user.id))[0].status).toBe("filled");
    expect((await intentsOf(user.id))[0].status).toBe("filled");
    expect(deps.rfq.submit).toHaveBeenCalledWith("rfq_0", "claim_0", hashOf(99));
    expect(await eventTypes(user.id)).toEqual(["converted"]);
  });

  it("marks a swap failed when a later nonce was mined without it", async () => {
    const user = await freelancer();
    await pendingSwap(user.id);
    const { deps, state } = harness({});
    state.confirmedNonce = 8;
    expect((await runTreasuryForUser(deps, user.id)).outcome).toBe("idle");
    expect((await tradesOf(user.id))[0].status).toBe("failed");
    expect(await eventTypes(user.id)).toEqual(["swap_failed"]);
    expect(state.sent).toEqual([]);
  });

  it("leaves a broadcast swap pending when its receipt does not arrive in time", async () => {
    const user = await freelancer();
    const { deps, state } = harness({ WARS: pesos(3_200n), ...gas });
    state.receipts.set(hashOf(2), null);
    expect(await runTreasuryForUser(deps, user.id)).toEqual({ userId: user.id, outcome: "pending_tx", detail: "swap" });
    expect((await tradesOf(user.id))[0].status).toBe("broadcast");
    expect((await db.select().from(treasuryTxs).where(eq(treasuryTxs.hash, hashOf(2))))[0].status).toBe("pending");
  });
});

describe("engineInput", () => {
  it("feeds the engine spendable balances, with the gas reserve held back", async () => {
    const user = await freelancer("16000.00");
    const ctx = await loadTreasuryContext(db, user.id);
    if (!ctx) throw new Error("no context");
    const input = await engineInput(db, ctx, { ...ZERO, USDT: 1_000_000n, WARS: pesos(3_200n) }, RATES, NOW);
    expect(input).toEqual({
      balances: { USDT: 950_000n, USAT: 0n, WARS: pesos(3_200n), WBRL: 0n },
      rules: { localCurrency: "ARS", reserveAmount: "16000.00", autoTopUp: true, perTradeMaxUsd: 50, dailyMaxUsd: 200 },
      rates: RATES,
      filledUsdWad24h: 0n,
    });
  });
});

describe("runTreasuries", () => {
  it("keeps going after one wallet fails, and stops starting new ones after the deadline", async () => {
    const run = vi.fn(async (userId: string) => {
      if (userId === "b") throw new Error("boom");
      return { userId, outcome: "idle" as const };
    });
    expect(await runTreasuries(["a", "b", "c"], run)).toEqual([
      { userId: "a", outcome: "idle" },
      { userId: "b", outcome: "failed", detail: "boom" },
      { userId: "c", outcome: "idle" },
    ]);
    let clock = 0;
    const timed = await runTreasuries(["a", "b", "c"], async (userId) => ((clock += 100), { userId, outcome: "idle" as const }), {
      deadline: 150,
      now: () => clock,
    });
    expect(timed.map((r) => r.userId)).toEqual(["a", "b"]);
    expect(summarizeRuns([...timed, { userId: "x", outcome: "converted" }])).toEqual({ idle: 2, converted: 1 });
  });
});
