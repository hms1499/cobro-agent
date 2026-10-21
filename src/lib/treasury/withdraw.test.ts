// src/lib/treasury/withdraw.test.ts
import { eq, sql } from "drizzle-orm";
import { decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import { TEXTILE_REACTOR } from "@/lib/chain/treasury-tx";
import type { Db } from "@/lib/db/client";
import { agentEvents, treasuryTxs, treasuryWallets, users } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "./balances";
import { TxRejectedError, type ExecutorDeps } from "./executor";
import { acquireWalletLock } from "./repo";
import { insertSavedAddress, removeSavedAddress } from "@/lib/addresses/repo";
import { parseWithdrawForm, withdraw, withdrawableAmount } from "./withdraw";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const PERSONAL: Address = "0x3333333333333333333333333333333333333333";
const SAVED: Address = "0x4444444444444444444444444444444444444444";
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };

describe("withdrawableAmount", () => {
  it("is the whole balance unless the same token must also pay the gas", () => {
    expect(withdrawableAmount("USDT", { ...ZERO, USDT: 1_000_000n })).toBe(980_000n);
    expect(withdrawableAmount("USDT", { ...ZERO, USDT: 1_000_000n, USDC: 50_000n })).toBe(1_000_000n);
    expect(withdrawableAmount("WARS", { ...ZERO, WARS: 5n })).toBe(5n);
    expect(withdrawableAmount("USAT", { ...ZERO, USAT: 10_000n })).toBe(0n);
  });
});

describe("parseWithdrawForm", () => {
  const balances = { ...ZERO, USDT: 2_000_000n, WARS: 10n ** 22n };
  it("reads an amount in the asset's own currency, with a dot or a comma", () => {
    expect(parseWithdrawForm({ asset: "USDT", amount: "1.5", to: "personal" }, balances)).toEqual({ ok: true, data: { asset: "USDT", amount: 1_500_000n, to: "personal" } });
    expect(parseWithdrawForm({ asset: "WARS", amount: "1000,50", to: "personal" }, balances)).toEqual({
      ok: true,
      data: { asset: "WARS", amount: 1_000_500_000_000_000_000_000n, to: "personal" },
    });
  });

  it("takes everything available when asked", () => {
    expect(parseWithdrawForm({ asset: "USDT", all: "on", to: "personal" }, balances)).toEqual({ ok: true, data: { asset: "USDT", amount: 1_980_000n, to: "personal" } });
  });

  it("names the field that is wrong", () => {
    expect(parseWithdrawForm({ asset: "USAT", amount: "1", to: "personal" }, balances)).toEqual({ ok: false, errors: { asset: "withdraw.error.asset" } });
    expect(parseWithdrawForm({ asset: "USDT", amount: "1.995", to: "personal" }, balances)).toEqual({ ok: false, errors: { amount: "money.error.decimals" } });
    expect(parseWithdrawForm({ asset: "USDT", amount: "1.99", to: "personal" }, balances)).toEqual({ ok: false, errors: { amount: "withdraw.error.tooMuch" } });
  });

  it("needs a destination", () => {
    expect(parseWithdrawForm({ asset: "USDT", amount: "1" }, balances)).toEqual({ ok: false, errors: { to: "withdraw.error.to" } });
    expect(parseWithdrawForm({ asset: "USDT", amount: "1", to: "" }, balances)).toEqual({ ok: false, errors: { to: "withdraw.error.to" } });
    expect(parseWithdrawForm({ asset: "USDT", amount: "1", to: "abc" }, balances)).toMatchObject({ ok: true, data: { to: "abc" } });
  });
});

function deps(balances: Partial<TreasuryBalances>) {
  const signed: { to: Address; data: Hex }[] = [];
  const value: ExecutorDeps = {
    db,
    now: () => NOW,
    flags: { enabled: false, dryRun: true },
    rates: async () => ({ perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 }),
    chain: {
      readBalances: async () => ({ ...ZERO, ...balances }),
      allowance: async () => 0n,
      receipt: async () => null,
      confirmedNonce: async () => 0,
      knownTx: async () => false,
      sendRaw: async () => {},
      waitForReceipt: async () => "success",
    },
    signer: () => ({ address: getAddress(TEST_TREASURY), signDigest: vi.fn(), signTypedData: vi.fn() }),
    signTx: vi.fn<ExecutorDeps["signTx"]>(async (...args) => {
      const [, call, feeToken] = args;
      signed.push(call);
      return { hash: `0x${"77".repeat(32)}`, raw: "0x77" as Hex, nonce: 1, feeToken };
    }),
    rfq: { request: vi.fn(), cancel: vi.fn(), submit: vi.fn() },
    drip: vi.fn(async () => "0xd1" as Hex),
    allowedSpenders: [TEXTILE_REACTOR],
  };
  return { deps: value, signed };
}

async function freelancerWithWallet(personalWallet: string | null = PERSONAL) {
  const user = await seedFreelancer(db);
  await db.update(users).set({ personalWallet }).where(eq(users.id, user.id));
  return user;
}

describe("withdraw", () => {
  it("sends the amount to the personal wallet, tagged and recorded, even while the agent is off", async () => {
    const user = await freelancerWithWallet();
    const { deps: d, signed } = deps({ USDT: 2_000_000n });
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_000_000n, to: "personal" })).toEqual({
      ok: true,
      txHash: `0x${"77".repeat(32)}`,
      pending: false,
    });
    expect(signed[0].to).toBe(TOKENS.USDT.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: signed[0].data }).args).toEqual([PERSONAL, 1_000_000n]);
    const [tx] = await db.select().from(treasuryTxs);
    expect(tx).toMatchObject({ kind: "withdraw", asset: "USDT", amountAtomic: "1000000", toAddress: PERSONAL, usdCents: 100, status: "success" });
    expect((await db.select().from(agentEvents)).map((e) => e.type)).toEqual(["withdrawn"]);
  });

  it("sends to a saved address past its wait, with its label on record", async () => {
    const user = await freelancerWithWallet();
    const saved = await insertSavedAddress(db, user.id, { label: "Binance", address: SAVED }, new Date(NOW.getTime() - 24 * 3_600_000));
    const { deps: d, signed } = deps({ USDT: 2_000_000n });
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_000_000n, to: saved.id })).toMatchObject({ ok: true, pending: false });
    expect(decodeFunctionData({ abi: erc20Abi, data: signed[0].data }).args).toEqual([SAVED, 1_000_000n]);
    const [tx] = await db.select().from(treasuryTxs);
    expect(tx).toMatchObject({ toAddress: SAVED, toLabel: "Binance" });
    const [event] = await db.select().from(agentEvents);
    expect(event.data).toMatchObject({ toLabel: "Binance" });
  });

  it("records no label for the personal wallet", async () => {
    const user = await freelancerWithWallet();
    await withdraw(deps({ USDT: 2_000_000n }).deps, user.id, { asset: "USDT", amount: 1_000_000n, to: "personal" });
    expect((await db.select().from(treasuryTxs))[0].toLabel).toBeNull();
    expect((await db.select().from(agentEvents))[0].data.toLabel ?? null).toBeNull();
  });

  it("refuses a saved address still waiting, removed, belonging to someone else, or not an id", async () => {
    const user = await freelancerWithWallet();
    const other = await seedFreelancer(db, { treasuryAddress: null });
    const day = 24 * 3_600_000;
    const waiting = await insertSavedAddress(db, user.id, { label: "New", address: SAVED }, new Date(NOW.getTime() - day + 1000));
    const removed = await insertSavedAddress(db, user.id, { label: "Old", address: "0x5555555555555555555555555555555555555555" }, new Date(NOW.getTime() - 2 * day));
    await removeSavedAddress(db, user.id, removed.id, NOW);
    const theirs = await insertSavedAddress(db, other.id, { label: "Theirs", address: SAVED }, new Date(NOW.getTime() - 2 * day));
    const { deps: d, signed } = deps({ USDT: 2_000_000n });
    for (const to of [waiting.id, removed.id, theirs.id, "not-a-uuid"]) {
      expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_000_000n, to })).toEqual({ ok: false, error: "destination_not_ready" });
    }
    expect(signed).toHaveLength(0);
    expect(await db.select().from(treasuryTxs)).toHaveLength(0);
  });

  it("honours a removal made while the withdrawal was already under way", async () => {
    const user = await freelancerWithWallet();
    const saved = await insertSavedAddress(db, user.id, { label: "Binance", address: SAVED }, new Date(NOW.getTime() - 24 * 3_600_000));
    const { deps: d, signed } = deps({ USDT: 2_000_000n });
    const read = d.chain.readBalances;
    d.chain.readBalances = async (address) => {
      // The owner removes the address after the early check passed, before anything is signed.
      await removeSavedAddress(db, user.id, saved.id, NOW);
      return read(address);
    };
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_000_000n, to: saved.id })).toEqual({ ok: false, error: "destination_not_ready" });
    expect(signed).toHaveLength(0);
    expect(d.signTx).not.toHaveBeenCalled();
    expect(await db.select().from(treasuryTxs)).toHaveLength(0);
  });

  it("honours a removal made while the USD rate was being fetched, right before signing", async () => {
    const user = await freelancerWithWallet();
    const saved = await insertSavedAddress(db, user.id, { label: "Binance", address: SAVED }, new Date(NOW.getTime() - 24 * 3_600_000));
    const { deps: d, signed } = deps({ USDT: 2_000_000n });
    const rates = d.rates;
    d.rates = async () => {
      await removeSavedAddress(db, user.id, saved.id, NOW);
      return rates();
    };
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_000_000n, to: saved.id })).toEqual({ ok: false, error: "destination_not_ready" });
    expect(signed).toHaveLength(0);
    expect(d.signTx).not.toHaveBeenCalled();
    expect(await db.select().from(treasuryTxs)).toHaveLength(0);
  });

  it("refuses a bad destination before any chain work", async () => {
    const user = await freelancerWithWallet();
    const { deps: d } = deps({ USDT: 2_000_000n });
    const readBalances = vi.fn(d.chain.readBalances);
    d.chain.readBalances = readBalances;
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_000_000n, to: crypto.randomUUID() })).toEqual({ ok: false, error: "destination_not_ready" });
    expect(readBalances).not.toHaveBeenCalled();
    expect(d.drip).not.toHaveBeenCalled();
  });

  it("a saved address works without a personal wallet", async () => {
    const user = await freelancerWithWallet(null);
    const saved = await insertSavedAddress(db, user.id, { label: "Binance", address: SAVED }, new Date(NOW.getTime() - 24 * 3_600_000));
    expect(await withdraw(deps({ USDT: 2_000_000n }).deps, user.id, { asset: "USDT", amount: 1_000_000n, to: saved.id })).toMatchObject({ ok: true });
  });

  it("refuses without a personal wallet, above the available amount, or while the wallet is busy", async () => {
    const noWallet = await freelancerWithWallet(null);
    expect(await withdraw(deps({ USDT: 2_000_000n }).deps, noWallet.id, { asset: "USDT", amount: 1n, to: "personal" })).toEqual({
      ok: false,
      error: "no_personal_wallet",
    });

    const user = await freelancerWithWallet();
    const { deps: d, signed } = deps({ USDT: 2_000_000n });
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_990_000n, to: "personal" })).toEqual({ ok: false, error: "insufficient" });

    const [wallet] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, user.id));
    await acquireWalletLock(db, wallet.id, crypto.randomUUID(), NOW);
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1n, to: "personal" })).toEqual({ ok: false, error: "busy" });
    expect(signed).toHaveLength(0);
  });

  it("reports unconfirmed, not failed, when signing or the network throws", async () => {
    const user = await freelancerWithWallet();
    const a = deps({ USDT: 2_000_000n });
    a.deps.signTx = vi.fn(async () => {
      throw new Error("para down");
    });
    expect(await withdraw(a.deps, user.id, { asset: "USDT", amount: 1_000_000n, to: "personal" })).toEqual({ ok: false, error: "unconfirmed" });

    const b = deps({ USDT: 2_000_000n });
    b.deps.chain.sendRaw = async () => {
      throw new Error("rpc 500");
    };
    expect(await withdraw(b.deps, user.id, { asset: "USDT", amount: 1_000_000n, to: "personal" })).toEqual({ ok: false, error: "unconfirmed" });
  });

  it("marks a withdrawal the node refuses as failed at once, says so, and does not block the next one", async () => {
    const user = await freelancerWithWallet();
    const a = deps({ USDT: 2_000_000n });
    a.deps.chain.sendRaw = async () => {
      throw new TxRejectedError("invalid sender");
    };
    expect(await withdraw(a.deps, user.id, { asset: "USDT", amount: 1_000_000n, to: "personal" })).toEqual({ ok: false, error: "failed" });
    const [tx] = await db.select().from(treasuryTxs);
    expect(tx.status).toBe("failed");
    expect((await db.select().from(agentEvents)).map((e) => [e.type, e.data.detail])).toEqual([["withdraw_failed", "rejected"]]);

    const b = deps({ USDT: 2_000_000n });
    b.deps.signTx = vi.fn(async (_signer, _call, feeToken) => ({ hash: `0x${"78".repeat(32)}` as Hex, raw: "0x78" as Hex, nonce: 1, feeToken }));
    expect(await withdraw(b.deps, user.id, { asset: "USDT", amount: 1_000_000n, to: "personal" })).toMatchObject({ ok: true, pending: false });
  });

  it("logs no destination address or label when recording the transaction fails, only the user and hash", async () => {
    const user = await freelancerWithWallet();
    const saved = await insertSavedAddress(db, user.id, { label: "Binance", address: SAVED }, new Date(NOW.getTime() - 24 * 3_600_000));
    await db.execute(sql`CREATE OR REPLACE FUNCTION fail_tx() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'tx insert failed'; END $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER fail_tx BEFORE INSERT ON treasury_txs FOR EACH ROW EXECUTE FUNCTION fail_tx()`);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await withdraw(deps({ USDT: 2_000_000n }).deps, user.id, { asset: "USDT", amount: 1_000_000n, to: saved.id })).toEqual({
        ok: false,
        error: "unconfirmed",
      });
      const text = JSON.stringify(logged.mock.calls);
      expect(text).toContain(user.id);
      expect(text).toContain("77".repeat(32));
      expect(text.toLowerCase()).not.toContain(SAVED.toLowerCase().slice(2));
      expect(text).not.toContain("Binance");
    } finally {
      logged.mockRestore();
      await db.execute(sql`DROP TRIGGER fail_tx ON treasury_txs`);
    }
  });

  it("leaves the withdrawal pending, not settled without its event, when the settlement cannot be written", async () => {
    const user = await freelancerWithWallet();
    await db.execute(sql`CREATE OR REPLACE FUNCTION fail_event() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'event insert failed'; END $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER fail_event BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION fail_event()`);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await withdraw(deps({ USDT: 2_000_000n }).deps, user.id, { asset: "USDT", amount: 1_000_000n, to: "personal" })).toEqual({
        ok: false,
        error: "unconfirmed",
      });
    } finally {
      logged.mockRestore();
      await db.execute(sql`DROP TRIGGER fail_event ON agent_events`);
    }
    // Still pending, so the next reconciliation settles it and announces it.
    expect((await db.select().from(treasuryTxs))[0].status).toBe("pending");
  });
});
