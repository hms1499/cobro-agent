import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, TEST_TREASURY } from "@/lib/db/testing";
import { loadAppUser } from "./queries";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

describe("loadAppUser", () => {
  it("joins the treasury wallet and the chosen local currency", async () => {
    const user = await seedFreelancer(db, { localCurrency: "BRL" });
    expect(await loadAppUser(db, user.id)).toEqual({
      id: user.id,
      email: "ana@example.com",
      displayName: "Ana Diseño",
      treasuryStatus: "ready",
      treasuryAddress: TEST_TREASURY,
      localCurrency: "BRL",
    });
  });

  it("reports a user who has not onboarded and has no wallet yet", async () => {
    const [user] = await db.insert(users).values({ paraUserId: "para-new" }).returning();
    expect(await loadAppUser(db, user.id)).toMatchObject({
      treasuryStatus: "missing",
      treasuryAddress: null,
      localCurrency: null,
    });
  });

  it("returns null for an unknown user", async () => {
    expect(await loadAppUser(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
