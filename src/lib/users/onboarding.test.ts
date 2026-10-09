import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { rules, users } from "@/lib/db/schema";
import { createTestDb, resetDb } from "@/lib/db/testing";
import { parseOnboardingForm, saveOnboarding } from "./onboarding";

describe("parseOnboardingForm", () => {
  it("accepts a name, a currency and a reserve", () => {
    expect(parseOnboardingForm({ displayName: "  Ana Diseño ", localCurrency: "ARS", reserveAmount: "300000" })).toEqual({
      ok: true,
      data: { displayName: "Ana Diseño", localCurrency: "ARS", reserveAmount: "300000.00" },
    });
  });

  it("treats an empty reserve as zero", () => {
    const result = parseOnboardingForm({ displayName: "Ana", localCurrency: "BRL", reserveAmount: "" });
    expect(result).toMatchObject({ ok: true, data: { reserveAmount: "0.00" } });
  });

  it("names every problem at once", () => {
    expect(parseOnboardingForm({ displayName: " ", localCurrency: "USD", reserveAmount: "300.000,00" })).toEqual({
      ok: false,
      errors: {
        displayName: "onboarding.error.name",
        localCurrency: "onboarding.error.currency",
        reserveAmount: "money.error.format",
      },
    });
    expect(parseOnboardingForm({ displayName: "x".repeat(61), localCurrency: "ARS", reserveAmount: "0" })).toMatchObject({
      ok: false,
      errors: { displayName: "onboarding.error.nameLong" },
    });
  });
});

describe("saveOnboarding", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  it("stores the name and creates the rules, then updates them on a second save", async () => {
    const [user] = await db.insert(users).values({ paraUserId: "para-1" }).returning();
    await saveOnboarding(db, user.id, { displayName: "Ana", localCurrency: "ARS", reserveAmount: "300000.00" });
    await saveOnboarding(db, user.id, { displayName: "Ana D.", localCurrency: "BRL", reserveAmount: "1500.00" });
    const [saved] = await db.select().from(users).where(eq(users.id, user.id));
    const [userRules] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(saved.displayName).toBe("Ana D.");
    expect(userRules).toMatchObject({ localCurrency: "BRL", reserveAmount: "1500.00" });
  });
});
