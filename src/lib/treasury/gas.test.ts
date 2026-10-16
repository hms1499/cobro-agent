import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { treasuryWallets } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import { claimDrip, serializedDripper, type Dripper } from "./gas";

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

describe("serializedDripper", () => {
  const A: Address = "0x00000000000000000000000000000000000000aa";
  const B: Address = "0x00000000000000000000000000000000000000bb";

  it("sends one drip at a time, so concurrent wallets never read the same operator nonce", async () => {
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    const inner: Dripper = async (to) => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(`start ${to}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${to}`);
      active -= 1;
      return `0x${to.slice(-2).repeat(32)}` as Hex;
    };
    const drip = serializedDripper(inner);
    const hashes = await Promise.all([drip(A, 1n), drip(B, 1n)]);
    expect(peak).toBe(1);
    expect(order).toEqual([`start ${A}`, `end ${A}`, `start ${B}`, `end ${B}`]);
    expect(hashes).toEqual([`0x${"aa".repeat(32)}`, `0x${"bb".repeat(32)}`]);
  });

  it("keeps going after a failed drip and still reports that failure to its caller", async () => {
    const inner: Dripper = async (to) => {
      if (to === A) throw new Error("reverted");
      return `0x${"bb".repeat(32)}`;
    };
    const drip = serializedDripper(inner);
    const [first, second] = await Promise.allSettled([drip(A, 1n), drip(B, 1n)]);
    expect(first.status).toBe("rejected");
    expect(second).toEqual({ status: "fulfilled", value: `0x${"bb".repeat(32)}` });
  });
});
