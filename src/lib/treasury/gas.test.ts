import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { treasuryWallets } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import { claimDrip } from "./gas";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-10-15T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("claimDrip", () => {
  it("allows one drip per wallet per 24 hours", async () => {
    const user = await seedFreelancer(db);
    const [wallet] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, user.id));
    expect(await claimDrip(db, wallet.id, NOW)).toBe(true);
    expect(await claimDrip(db, wallet.id, hours(1))).toBe(false);
    expect(await claimDrip(db, wallet.id, hours(25))).toBe(true);
  });
});
