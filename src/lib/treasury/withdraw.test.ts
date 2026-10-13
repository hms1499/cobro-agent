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
    expect(parseWithdrawForm({ asset: "USDT", amount: "1.5" }, balances)).toEqual({ ok: true, data: { asset: "USDT", amount: 1_500_000n } });
    expect(parseWithdrawForm({ asset: "WARS", amount: "1000,50" }, balances)).toEqual({
      ok: true,
      data: { asset: "WARS", amount: 1_000_500_000_000_000_000_000n },
    });
  });

  it("takes everything available when asked", () => {
    expect(parseWithdrawForm({ asset: "USDT", all: "on" }, balances)).toEqual({ ok: true, data: { asset: "USDT", amount: 1_980_000n } });
  });

  it("names the field that is wrong", () => {
    expect(parseWithdrawForm({ asset: "USAT", amount: "1" }, balances)).toEqual({ ok: false, errors: { asset: "withdraw.error.asset" } });
    expect(parseWithdrawForm({ asset: "USDT", amount: "1.995" }, balances)).toEqual({ ok: false, errors: { amount: "money.error.decimals" } });
    expect(parseWithdrawForm({ asset: "USDT", amount: "1.99" }, balances)).toEqual({ ok: false, errors: { amount: "withdraw.error.tooMuch" } });
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
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_000_000n })).toEqual({
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

  it("refuses without a personal wallet, above the available amount, or while the wallet is busy", async () => {
    const noWallet = await freelancerWithWallet(null);
    expect(await withdraw(deps({ USDT: 2_000_000n }).deps, noWallet.id, { asset: "USDT", amount: 1n })).toEqual({
      ok: false,
      error: "no_personal_wallet",
    });

    const user = await freelancerWithWallet();
    const { deps: d, signed } = deps({ USDT: 2_000_000n });
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1_990_000n })).toEqual({ ok: false, error: "insufficient" });

    const [wallet] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, user.id));
    await acquireWalletLock(db, wallet.id, crypto.randomUUID(), NOW);
    expect(await withdraw(d, user.id, { asset: "USDT", amount: 1n })).toEqual({ ok: false, error: "busy" });
    expect(signed).toHaveLength(0);
  });

  it("reports unconfirmed, not failed, when signing or the network throws", async () => {
    const user = await freelancerWithWallet();
    const a = deps({ USDT: 2_000_000n });
    a.deps.signTx = vi.fn(async () => {
      throw new Error("para down");
    });
    expect(await withdraw(a.deps, user.id, { asset: "USDT", amount: 1_000_000n })).toEqual({ ok: false, error: "unconfirmed" });

    const b = deps({ USDT: 2_000_000n });
    b.deps.chain.sendRaw = async () => {
      throw new Error("rpc 500");
    };
    expect(await withdraw(b.deps, user.id, { asset: "USDT", amount: 1_000_000n })).toEqual({ ok: false, error: "unconfirmed" });
  });

  it("marks a withdrawal the node refuses as failed at once, says so, and does not block the next one", async () => {
    const user = await freelancerWithWallet();
    const a = deps({ USDT: 2_000_000n });
    a.deps.chain.sendRaw = async () => {
      throw new TxRejectedError("invalid sender");
    };
    expect(await withdraw(a.deps, user.id, { asset: "USDT", amount: 1_000_000n })).toEqual({ ok: false, error: "failed" });
    const [tx] = await db.select().from(treasuryTxs);
    expect(tx.status).toBe("failed");
    expect((await db.select().from(agentEvents)).map((e) => [e.type, e.data.detail])).toEqual([["withdraw_failed", "rejected"]]);

    const b = deps({ USDT: 2_000_000n });
    b.deps.signTx = vi.fn(async (_signer, _call, feeToken) => ({ hash: `0x${"78".repeat(32)}` as Hex, raw: "0x78" as Hex, nonce: 1, feeToken }));
    expect(await withdraw(b.deps, user.id, { asset: "USDT", amount: 1_000_000n })).toMatchObject({ ok: true, pending: false });
  });

  it("leaves the withdrawal pending, not settled without its event, when the settlement cannot be written", async () => {
    const user = await freelancerWithWallet();
    await db.execute(sql`CREATE OR REPLACE FUNCTION fail_event() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'event insert failed'; END $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER fail_event BEFORE INSERT ON agent_events FOR EACH ROW EXECUTE FUNCTION fail_event()`);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await withdraw(deps({ USDT: 2_000_000n }).deps, user.id, { asset: "USDT", amount: 1_000_000n })).toEqual({
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
