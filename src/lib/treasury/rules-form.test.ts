import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import { parseRulesForm, rulesFormValues, saveRules } from "./rules-form";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const VALID = {
  reserveAmount: "300000",
  autoTopUp: "on",
  maxSlippagePct: "0.5",
  hardMaxSlippagePct: "1,5",
  maxWaitHours: "6",
  perTradeMaxUsd: "50",
  dailyMaxUsd: "200",
  approvalMode: "sell_usd",
};

describe("parseRulesForm", () => {
  it("reads the sentence and the advanced settings", () => {
    expect(parseRulesForm(VALID)).toEqual({
      ok: true,
      data: {
        reserveAmount: "300000.00",
        autoTopUp: true,
        maxSlippageBps: 50,
        hardMaxSlippageBps: 150,
        maxWaitMinutes: 360,
        perTradeMaxUsd: 50,
        dailyMaxUsd: 200,
        approvalMode: "sell_usd",
      },
    });
  });

  it("treats an empty reserve as 0 and an unticked box as off", () => {
    const rest: Partial<typeof VALID> = { ...VALID };
    delete rest.autoTopUp;
    expect(parseRulesForm({ ...rest, reserveAmount: "" })).toMatchObject({ ok: true, data: { reserveAmount: "0.00", autoTopUp: false } });
  });

  it("names every field that is out of range", () => {
    expect(
      parseRulesForm({
        reserveAmount: "1.500,50",
        maxSlippagePct: "0",
        hardMaxSlippagePct: "11",
        maxWaitHours: "49",
        perTradeMaxUsd: "0",
        dailyMaxUsd: "5001",
        approvalMode: "sell_usd",
      }),
    ).toEqual({
      ok: false,
      errors: {
        reserveAmount: "money.error.format",
        maxSlippagePct: "rules.error.slippage",
        hardMaxSlippagePct: "rules.error.hardSlippage",
        maxWaitHours: "rules.error.wait",
        perTradeMaxUsd: "rules.error.perTrade",
        dailyMaxUsd: "rules.error.daily",
      },
    });
    expect(parseRulesForm({ ...VALID, hardMaxSlippagePct: "0.4" })).toEqual({
      ok: false,
      errors: { hardMaxSlippagePct: "rules.error.hardSlippage" },
    });
    expect(parseRulesForm({ ...VALID, dailyMaxUsd: "40" })).toEqual({ ok: false, errors: { dailyMaxUsd: "rules.error.daily" } });
  });
});

describe("saving rules", () => {
  it("stores them and shows them back as the form had them", async () => {
    const user = await seedFreelancer(db);
    const parsed = parseRulesForm(VALID);
    if (!parsed.ok) throw new Error("fixture must parse");
    await saveRules(db, user.id, parsed.data, new Date("2026-10-15T12:00:00Z"));
    const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(row).toMatchObject({ reserveAmount: "300000.00", maxSlippageBps: 50, hardMaxSlippageBps: 150, maxWaitMinutes: 360 });
    expect(rulesFormValues(row)).toEqual({ ...VALID, reserveAmount: "300000.00", hardMaxSlippagePct: "1.5" });
    expect(parseRulesForm(rulesFormValues(row))).toEqual(parsed);
  });
});

describe("approval mode", () => {
  it("reads each mode and refuses others", () => {
    for (const approvalMode of ["auto", "sell_usd", "all"] as const) {
      const parsed = parseRulesForm({ ...VALID, approvalMode });
      expect(parsed.ok && parsed.data.approvalMode).toBe(approvalMode);
    }
    expect(parseRulesForm({ ...VALID, approvalMode: "sometimes" })).toEqual({
      ok: false,
      errors: { approvalMode: "rules.error.approvalMode" },
    });
  });

  it("round-trips through the stored rules", async () => {
    const user = await seedFreelancer(db);
    const parsed = parseRulesForm({ ...VALID, approvalMode: "all" });
    if (!parsed.ok) throw new Error("expected valid rules");
    await saveRules(db, user.id, parsed.data, new Date());
    const [row] = await db.select().from(rules).where(eq(rules.userId, user.id));
    expect(rulesFormValues(row).approvalMode).toBe("all");
  });
});
