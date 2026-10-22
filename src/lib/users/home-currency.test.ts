import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { agentEvents, fxIntents, rules } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import { changeHomeCurrency, parseHomeCurrencyForm, switchConsequences } from "./home-currency";

const NOW = new Date("2026-10-22T12:00:00Z");
const rates: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const ZERO: TreasuryBalances = { USDT: 0n, USAT: 0n, USDC: 0n, WARS: 0n, WBRL: 0n };
const units = (n: bigint) => n * 10n ** 18n;

describe("parseHomeCurrencyForm", () => {
  it("stores no reserve for US dollars, whatever was posted", () => {
    expect(parseHomeCurrencyForm({ home: "USD", reserveAmount: "9000" })).toEqual({ ok: true, data: { home: "USD", reserveAmount: "0" } });
  });

  it("needs a reserve for pesos or reais, and a known currency", () => {
    expect(parseHomeCurrencyForm({ home: "BRL", reserveAmount: "" })).toMatchObject({ ok: false, errors: { reserveAmount: "money.error.required" } });
    expect(parseHomeCurrencyForm({ home: "ARS", reserveAmount: "150000" })).toEqual({ ok: true, data: { home: "ARS", reserveAmount: "150000.00" } });
    expect(parseHomeCurrencyForm({ home: "XYZ", reserveAmount: "1" })).toMatchObject({ ok: false, errors: { home: "settings.currencyError" } });
  });
});

describe("switchConsequences", () => {
  it("lists the pesos or reais a switch would convert, ignoring dust under US$1", () => {
    expect(switchConsequences("USD", { ...ZERO, WARS: units(3_200n), WBRL: units(1n) / 2n }, rates)).toEqual({
      converts: [{ asset: "WARS", amount: "3200.00", currency: "ARS" }],
    });
    expect(switchConsequences("ARS", { ...ZERO, WARS: units(3_200n), WBRL: units(20n) }, rates)).toEqual({
      converts: [{ asset: "WBRL", amount: "20.00", currency: "BRL" }],
    });
    expect(switchConsequences("ARS", { ...ZERO, WARS: units(3_200n) }, null)).toEqual({ converts: [] });
  });
});

describe("changeHomeCurrency", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  it("switches to dollars, cancels a waiting proposal and logs the change", async () => {
    const user = await seedFreelancer(db);
    await db.update(rules).set({ reserveAmount: "150000.00" }).where(eq(rules.userId, user.id));
    const [proposal] = await db
      .insert(fxIntents)
      .values({ userId: user.id, fromAsset: "USDT", toAsset: "WARS", amountAtomic: "5000000", reason: "top_up", status: "proposed", createdAt: NOW, updatedAt: NOW })
      .returning();

    expect(await changeHomeCurrency(db, user.id, { home: "USD", reserveAmount: "0" }, NOW)).toEqual({ changed: true });

    const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(row).toMatchObject({ localCurrency: "USD", reserveAmount: "0.00" });
    const [intent] = await db.select().from(fxIntents).where(eq(fxIntents.id, proposal.id));
    expect(intent.status).toBe("cancelled");
    const events = await db.select().from(agentEvents).where(eq(agentEvents.userId, user.id));
    expect(events.map((e) => [e.type, e.data])).toEqual([["home_currency_changed", { from: "ARS", to: "USD" }]]);
  });

  it("only updates the reserve when the currency stays the same", async () => {
    const user = await seedFreelancer(db);
    expect(await changeHomeCurrency(db, user.id, { home: "ARS", reserveAmount: "90000.00" }, NOW)).toEqual({ changed: false });
    const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(row).toMatchObject({ localCurrency: "ARS", reserveAmount: "90000.00" });
    expect(await db.select().from(agentEvents).where(eq(agentEvents.userId, user.id))).toEqual([]);
  });
});
