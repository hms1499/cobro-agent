import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, resetDb, seedFreelancer, seedInvoice } from "@/lib/db/testing";
import { lockQuote } from "./quotes-repo";

let db: Db;
let invoiceId: string;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
  const user = await seedFreelancer(db);
  invoiceId = (await seedInvoice(db, user.id)).id;
});

const at = (iso: string) => new Date(`2026-10-15T${iso}Z`);

describe("lockQuote", () => {
  it("prices once and keeps that price for 10 minutes", async () => {
    const compute = vi.fn(() => ({ amountAtomic: 300_000000n, rate: "1" }));
    const first = await lockQuote(db, { invoiceId, asset: "USDT", now: at("12:00:00"), compute });
    expect(first.amountAtomic).toBe(300_000000n);
    expect(first.expiresAt).toEqual(at("12:10:00"));

    const again = await lockQuote(db, {
      invoiceId,
      asset: "USDT",
      now: at("12:09:59"),
      compute: () => ({ amountAtomic: 1n, rate: "9" }),
    });
    expect(again.amountAtomic).toBe(300_000000n);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("re-prices once the lock has expired", async () => {
    await lockQuote(db, { invoiceId, asset: "WARS", now: at("12:00:00"), compute: () => ({ amountAtomic: 5n, rate: "1" }) });
    const later = await lockQuote(db, {
      invoiceId,
      asset: "WARS",
      now: at("12:10:00"),
      compute: () => ({ amountAtomic: 6n, rate: "1.2" }),
    });
    expect(later.amountAtomic).toBe(6n);
    expect(later.expiresAt).toEqual(at("12:20:00"));
  });

  it("keeps a separate lock per asset", async () => {
    await lockQuote(db, { invoiceId, asset: "USDT", now: at("12:00:00"), compute: () => ({ amountAtomic: 1n, rate: "1" }) });
    const wars = await lockQuote(db, {
      invoiceId,
      asset: "WARS",
      now: at("12:00:00"),
      compute: () => ({ amountAtomic: 2n, rate: "1" }),
    });
    expect(wars.amountAtomic).toBe(2n);
  });

  it("lets two simultaneous requests agree on one price", async () => {
    const [a, b] = await Promise.all([
      lockQuote(db, { invoiceId, asset: "USDT", now: at("12:00:00"), compute: () => ({ amountAtomic: 1n, rate: "1" }) }),
      lockQuote(db, { invoiceId, asset: "USDT", now: at("12:00:00"), compute: () => ({ amountAtomic: 2n, rate: "1" }) }),
    ]);
    expect(a.amountAtomic).toBe(b.amountAtomic);
  });

  it("does not store anything when pricing fails", async () => {
    await expect(
      lockQuote(db, {
        invoiceId,
        asset: "WARS",
        now: at("12:00:00"),
        compute: () => {
          throw new Error("rates down");
        },
      }),
    ).rejects.toThrow("rates down");
    const retry = await lockQuote(db, {
      invoiceId,
      asset: "WARS",
      now: at("12:00:01"),
      compute: () => ({ amountAtomic: 3n, rate: "1" }),
    });
    expect(retry.amountAtomic).toBe(3n);
  });
});
