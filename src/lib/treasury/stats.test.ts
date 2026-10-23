// src/lib/treasury/stats.test.ts
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { fxTrades, payments, recurringInvoices, treasuryTxs } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice } from "@/lib/db/testing";
import { paymentsForPnl, recentConversions, repeatClients, volumeStats, withdrawnUsdWad } from "./stats";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const T = (time: string) => new Date(`2026-10-15T${time}Z`);

describe("stats", () => {
  it("reads one freelancer's payments, withdrawals and RFQ volume", async () => {
    const user = await seedFreelancer(db);
    const other = await seedFreelancer(db);
    const invoice = await seedInvoice(db, user.id);
    const foreign = await seedInvoice(db, other.id);
    await db.insert(payments).values([
      { invoiceId: invoice.id, payer: "0xa", asset: "USDT", amountAtomic: "5", txHash: "0x1", ratesSnapshot: { ARS: "1600" } },
      { invoiceId: foreign.id, payer: "0xb", asset: "USDT", amountAtomic: "9", txHash: "0x2" },
    ]);
    expect(await paymentsForPnl(db, user.id)).toEqual([{ asset: "USDT", amountAtomic: 5n, ratesSnapshot: { ARS: "1600" } }]);

    const tx = { userId: user.id, kind: "withdraw", raw: "0x", feeToken: "USDT" } as const;
    await db.insert(treasuryTxs).values([
      { ...tx, nonce: 1, hash: "0xw1", status: "success", usdCents: 150 },
      { ...tx, nonce: 2, hash: "0xw2", status: "reverted", usdCents: 999 },
    ]);
    expect(await withdrawnUsdWad(db, user.id)).toBe(15n * 10n ** 17n);

    const trade = { userId: user.id, sellAsset: "WARS", buyAsset: "USDT", sellAmount: "1" } as const;
    await db.insert(fxTrades).values([
      { ...trade, status: "no_quote" },
      { ...trade, status: "rejected" },
      { ...trade, status: "filled", notionalUsdCents: 200, filledAt: T("10:00:00") },
      { ...trade, status: "filled", notionalUsdCents: 300, filledAt: T("11:00:00") },
    ]);
    expect(await volumeStats(db, user.id)).toEqual({ requested: 4, quoted: 3, filled: 2, filledUsdCents: 500 });
    expect((await recentConversions(db, user.id)).map((t) => t.notionalUsdCents)).toEqual([300, 200]);
  });

  it("groups payments per recurring template with distinct payers", async () => {
    const user = await seedFreelancer(db);
    const [template] = await db
      .insert(recurringInvoices)
      .values({
        slug: "rec1",
        userId: user.id,
        clientName: "Acme",
        description: "Maintenance",
        amount: "100",
        currency: "USD",
        interval: "weekly",
        anchorDay: 1,
        nextIssueAt: T("12:00:00"),
      })
      .returning();
    const a = await seedInvoice(db, user.id, { slug: "p1", recurringId: template.id, periodStart: T("00:00:00"), description: "m", amount: "100", status: "paid" });
    const b = await seedInvoice(db, user.id, { slug: "p2", recurringId: template.id, periodStart: T("01:00:00"), description: "m", amount: "100", status: "paid" });
    await db.insert(payments).values([
      { invoiceId: a.id, payer: "0xAbC", asset: "USAT", amountAtomic: "1", txHash: "0x3", settledAt: T("09:00:00") },
      { invoiceId: b.id, payer: "0xabc", asset: "USAT", amountAtomic: "1", txHash: "0x4", settledAt: T("10:00:00") },
    ]);
    expect(await repeatClients(db, user.id)).toEqual([
      { recurringId: template.id, clientName: "Acme", interval: "weekly", paidCount: 2, payerCount: 1, lastPaidAt: T("10:00:00") },
    ]);
  });
});
