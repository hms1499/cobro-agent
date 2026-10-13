import { eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS } from "@/lib/chain/tokens";
import type { Db } from "@/lib/db/client";
import { agentEvents, invoiceQuotes, invoices, payments } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice, TEST_TREASURY } from "@/lib/db/testing";
import { SETTLING_HOLD_MS } from "./invoice-claim";
import { logTransferFinder, reconcileSettlements, type FindTransfer } from "./reconcile";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const PAYER: Address = "0x9999999999999999999999999999999999999999";
const TX = `0x${"ef".repeat(32)}` as Hex;
const TX_OTHER = `0x${"ab".repeat(32)}` as Hex;

async function stuckInvoice(settlingUntil = new Date(NOW.getTime() - 60_000)) {
  const user = await seedFreelancer(db);
  const invoice = await seedInvoice(db, user.id, { status: "settling", settlingUntil });
  await db.insert(invoiceQuotes).values([
    { invoiceId: invoice.id, asset: "USDT", amountAtomic: "300000000", rate: "1", expiresAt: NOW },
    { invoiceId: invoice.id, asset: "WARS", amountAtomic: "481648500000000000000000", rate: "1605.495", expiresAt: NOW },
  ]);
  return { user, invoice };
}
const invoiceRow = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0];

describe("reconcileSettlements", () => {
  it("records a transfer that landed after an unknown outcome", async () => {
    const { user, invoice } = await stuckInvoice();
    const find = vi.fn<FindTransfer>(async ({ token }) => (token === TOKENS.USDT.address ? [{ txHash: TX, from: PAYER }] : []));
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 1, reopened: 0, errors: 0 });
    expect(find).toHaveBeenCalledWith({
      token: TOKENS.USDT.address,
      to: getAddress(TEST_TREASURY),
      amount: 300_000_000n,
      since: new Date(NOW.getTime() - 60_000 - SETTLING_HOLD_MS - 60_000),
      until: new Date(NOW.getTime() - 60_000 + 60_000),
    });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "paid", settlingUntil: null });
    expect(await db.select().from(payments)).toMatchObject([{ payer: PAYER, asset: "USDT", amountAtomic: "300000000", txHash: TX }]);
    expect((await db.select().from(agentEvents).where(eq(agentEvents.userId, user.id)))[0].type).toBe("payment_reconciled");
  });

  it("reopens the invoice when nothing arrived", async () => {
    const { invoice } = await stuckInvoice();
    expect(await reconcileSettlements(db, vi.fn<FindTransfer>(async () => []), NOW)).toEqual({ recorded: 0, reopened: 1, errors: 0 });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "open", settlingUntil: null });
  });

  it("leaves an invoice alone while its hold is still running", async () => {
    const { invoice } = await stuckInvoice(new Date(NOW.getTime() + 60_000));
    const find = vi.fn<FindTransfer>();
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 0, reopened: 0, errors: 0 });
    expect(find).not.toHaveBeenCalled();
    expect((await invoiceRow(invoice.id)).status).toBe("settling");
  });

  it("never matches a transfer that is already recorded for another invoice", async () => {
    const { user, invoice } = await stuckInvoice();
    const other = await seedInvoice(db, user.id, { status: "paid" });
    await db.insert(payments).values({ invoiceId: other.id, payer: PAYER, asset: "USDT", amountAtomic: "300000000", txHash: TX });
    const find = vi.fn<FindTransfer>(async ({ token }) => (token === TOKENS.USDT.address ? [{ txHash: TX, from: PAYER }] : []));
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 0, reopened: 1, errors: 0 });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "open", settlingUntil: null });
    expect(await db.select().from(payments)).toHaveLength(1);
  });

  it("skips a recorded transfer and matches a different, unrecorded one", async () => {
    const { user, invoice } = await stuckInvoice();
    const other = await seedInvoice(db, user.id, { status: "paid" });
    await db.insert(payments).values({ invoiceId: other.id, payer: PAYER, asset: "USDT", amountAtomic: "300000000", txHash: TX });
    const find = vi.fn<FindTransfer>(async ({ token }) =>
      token === TOKENS.USDT.address ? [{ txHash: TX, from: PAYER }, { txHash: TX_OTHER, from: PAYER }] : [],
    );
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 1, reopened: 0, errors: 0 });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "paid" });
    const rows = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    expect(rows).toMatchObject([{ txHash: TX_OTHER }]);
  });
});

describe("reconcileSettlements guards and failures", () => {
  it("leaves an invoice alone when a newer claim appeared while searching", async () => {
    const { invoice } = await stuckInvoice();
    const find = vi.fn<FindTransfer>(async () => {
      await db.update(invoices).set({ settlingUntil: new Date(NOW.getTime() + 300_000) }).where(eq(invoices.id, invoice.id));
      return [];
    });
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 0, reopened: 0, errors: 0 });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "settling" });
  });

  it("does not pay an invoice whose claim moved, even if a transfer was found", async () => {
    const { invoice } = await stuckInvoice();
    const find = vi.fn<FindTransfer>(async () => {
      await db.update(invoices).set({ settlingUntil: new Date(NOW.getTime() + 300_000) }).where(eq(invoices.id, invoice.id));
      return [{ txHash: TX, from: PAYER }];
    });
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 0, reopened: 0, errors: 0 });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "settling" });
    expect(await db.select().from(payments)).toHaveLength(0);
  });

  it("is case-insensitive about a transfer recorded under another hash casing", async () => {
    const { user, invoice } = await stuckInvoice();
    const other = await seedInvoice(db, user.id, { status: "paid" });
    await db.insert(payments).values({ invoiceId: other.id, payer: PAYER, asset: "USDT", amountAtomic: "300000000", txHash: TX.toUpperCase().replace("0X", "0x") });
    const find = vi.fn<FindTransfer>(async ({ token }) => (token === TOKENS.USDT.address ? [{ txHash: TX, from: PAYER }] : []));
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 0, reopened: 1, errors: 0 });
    expect((await invoiceRow(invoice.id)).status).toBe("open");
  });

  it("reopens rather than pays when the only transfer is recorded elsewhere", async () => {
    const { user, invoice } = await stuckInvoice();
    const other = await seedInvoice(db, user.id, { status: "paid" });
    // The row appears while searching; the guarded write itself is pinned in invoice-claim.test.ts.
    const find = vi.fn<FindTransfer>(async ({ token }) => {
      if (token !== TOKENS.USDT.address) return [];
      await db.insert(payments).values({ invoiceId: other.id, payer: PAYER, asset: "USDT", amountAtomic: "300000000", txHash: TX });
      return [{ txHash: TX, from: PAYER }];
    });
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 0, reopened: 1, errors: 0 });
    expect(await db.select().from(payments).where(eq(payments.invoiceId, invoice.id))).toHaveLength(0);
  });

  it("keeps going when one invoice fails, and counts the error", async () => {
    const first = await stuckInvoice(new Date(NOW.getTime() - 120_000));
    const second = await stuckInvoice(new Date(NOW.getTime() - 60_000));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const find = vi.fn<FindTransfer>(async () => {
      calls += 1;
      if (calls <= 1) throw new Error("rpc down");
      return [];
    });
    const result = await reconcileSettlements(db, find, NOW);
    spy.mockRestore();
    expect(result).toEqual({ recorded: 0, reopened: 1, errors: 1 });
    expect((await invoiceRow(first.invoice.id)).status).toBe("settling");
    expect((await invoiceRow(second.invoice.id)).status).toBe("open");
  });
});

describe("logTransferFinder", () => {
  const log = (value: bigint, hash: Hex) => ({ args: { from: PAYER, to: TEST_TREASURY, value }, transactionHash: hash });
  const make = () => {
    const client = {
      getBlockNumber: vi.fn(async () => 10_000n),
      getLogs: vi.fn(async () => [log(5n, `0x${"01".repeat(32)}` as Hex), log(7n, TX), log(7n, TX_OTHER)]),
    };
    return { client, find: logTransferFinder(client as unknown as Parameters<typeof logTransferFinder>[0], () => NOW.getTime()) };
  };
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  it("searches the window between the claim and the hold's end for transfers of exactly the amount", async () => {
    const { client, find } = make();
    expect(await find({ token: TOKENS.USDT.address, to: TEST_TREASURY, amount: 7n, since: ago(600_000), until: ago(300_000) })).toEqual([
      { txHash: TX, from: PAYER },
      { txHash: TX_OTHER, from: PAYER },
    ]);
    // 600 s back minus a 120-block margin; 300 s back plus the margin.
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 9_280n, toBlock: 9_820n, args: { to: TEST_TREASURY } }));
    expect(await find({ token: TOKENS.USDT.address, to: TEST_TREASURY, amount: 8n, since: ago(600_000), until: ago(300_000) })).toEqual([]);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);
  });

  it("still starts at the claim block for an invoice stuck for two days", async () => {
    const { client, find } = make();
    const client2 = { ...client, getBlockNumber: vi.fn(async () => 1_000_000n) };
    const f = logTransferFinder(client2 as unknown as Parameters<typeof logTransferFinder>[0], () => NOW.getTime());
    await f({ token: TOKENS.USDT.address, to: TEST_TREASURY, amount: 7n, since: ago(2 * 86_400_000), until: ago(2 * 86_400_000 - 400_000) });
    expect(client2.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 1_000_000n - 172_800n - 120n, toBlock: 1_000_000n - 172_800n + 400n + 120n }),
    );
    expect(find).toBeDefined();
  });

  it("does not look past the end of the hold", async () => {
    const { client, find } = make();
    await find({ token: TOKENS.USDT.address, to: TEST_TREASURY, amount: 7n, since: ago(600_000), until: ago(500_000) });
    const call = (client.getLogs.mock.calls[0] as unknown as [{ toBlock: bigint }])[0];
    expect(call.toBlock).toBe(9_620n);
  });
});
