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
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 1, reopened: 0 });
    expect(find).toHaveBeenCalledWith({
      token: TOKENS.USDT.address,
      to: getAddress(TEST_TREASURY),
      amount: 300_000_000n,
      since: new Date(NOW.getTime() - 60_000 - SETTLING_HOLD_MS - 60_000),
    });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "paid", settlingUntil: null });
    expect(await db.select().from(payments)).toMatchObject([{ payer: PAYER, asset: "USDT", amountAtomic: "300000000", txHash: TX }]);
    expect((await db.select().from(agentEvents).where(eq(agentEvents.userId, user.id)))[0].type).toBe("payment_reconciled");
  });

  it("reopens the invoice when nothing arrived", async () => {
    const { invoice } = await stuckInvoice();
    expect(await reconcileSettlements(db, vi.fn<FindTransfer>(async () => []), NOW)).toEqual({ recorded: 0, reopened: 1 });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "open", settlingUntil: null });
  });

  it("leaves an invoice alone while its hold is still running", async () => {
    const { invoice } = await stuckInvoice(new Date(NOW.getTime() + 60_000));
    const find = vi.fn<FindTransfer>();
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 0, reopened: 0 });
    expect(find).not.toHaveBeenCalled();
    expect((await invoiceRow(invoice.id)).status).toBe("settling");
  });

  it("never matches a transfer that is already recorded for another invoice", async () => {
    const { user, invoice } = await stuckInvoice();
    const other = await seedInvoice(db, user.id, { status: "paid" });
    await db.insert(payments).values({ invoiceId: other.id, payer: PAYER, asset: "USDT", amountAtomic: "300000000", txHash: TX });
    const find = vi.fn<FindTransfer>(async ({ token }) => (token === TOKENS.USDT.address ? [{ txHash: TX, from: PAYER }] : []));
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 0, reopened: 1 });
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
    expect(await reconcileSettlements(db, find, NOW)).toEqual({ recorded: 1, reopened: 0 });
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: "paid" });
    const rows = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    expect(rows).toMatchObject([{ txHash: TX_OTHER }]);
  });
});

describe("logTransferFinder", () => {
  it("searches the blocks since the claim for transfers of exactly the amount", async () => {
    const client = {
      getBlockNumber: vi.fn(async () => 10_000n),
      getLogs: vi.fn(async () => [
        { args: { from: PAYER, to: TEST_TREASURY, value: 5n }, transactionHash: `0x${"01".repeat(32)}` },
        { args: { from: PAYER, to: TEST_TREASURY, value: 7n }, transactionHash: TX },
        { args: { from: PAYER, to: TEST_TREASURY, value: 7n }, transactionHash: TX_OTHER },
      ]),
    };
    const find = logTransferFinder(client as unknown as Parameters<typeof logTransferFinder>[0], () => NOW.getTime());
    expect(await find({ token: TOKENS.USDT.address, to: TEST_TREASURY, amount: 7n, since: new Date(NOW.getTime() - 600_000) })).toEqual([
      { txHash: TX, from: PAYER },
      { txHash: TX_OTHER, from: PAYER },
    ]);
    // 600 s back plus a 120-block margin, at one block per second.
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 9_280n, toBlock: 10_000n, args: { to: TEST_TREASURY } }));
    expect(await find({ token: TOKENS.USDT.address, to: TEST_TREASURY, amount: 8n, since: new Date(NOW.getTime() - 600_000) })).toEqual([]);
  });
});
