import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { Db } from "@/lib/db/client";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import { ADDRESS_WAIT_MS } from "./validate";
import { insertSavedAddress, isUsable, listSavedAddresses, removeSavedAddress, usableSavedAddress } from "./repo";

const NOW = new Date("2026-10-21T12:00:00Z");
const ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address;
let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(() => resetDb(db));

describe("saved addresses", () => {
  it("a new address waits 24 hours", async () => {
    const user = await seedFreelancer(db);
    const row = await insertSavedAddress(db, user.id, { label: "Binance", address: ADDR }, NOW);
    expect(ADDRESS_WAIT_MS).toBe(24 * 60 * 60 * 1000);
    expect(row.usableAt).toEqual(new Date(NOW.getTime() + ADDRESS_WAIT_MS));
    expect(await usableSavedAddress(db, user.id, row.id, new Date(row.usableAt.getTime() - 1))).toBeNull();
    expect(await usableSavedAddress(db, user.id, row.id, row.usableAt)).toEqual(row);
    expect(isUsable(row, new Date(row.usableAt.getTime() - 1))).toBe(false);
    expect(isUsable(row, row.usableAt)).toBe(true);
  });

  it("removing takes effect at once and re-adding waits again", async () => {
    const user = await seedFreelancer(db);
    const row = await insertSavedAddress(db, user.id, { label: "Binance", address: ADDR }, NOW);
    expect(await listSavedAddresses(db, user.id)).toHaveLength(1);
    const later = new Date(NOW.getTime() + 48 * 3600_000);
    expect(await removeSavedAddress(db, user.id, row.id, later)).toBe(true);
    expect(await removeSavedAddress(db, user.id, row.id, later)).toBe(false);
    expect(await listSavedAddresses(db, user.id)).toEqual([]);
    expect(await usableSavedAddress(db, user.id, row.id, later)).toBeNull();
    const again = await insertSavedAddress(db, user.id, { label: "Binance", address: ADDR }, later);
    expect(again.id).not.toBe(row.id);
    expect(again.usableAt).toEqual(new Date(later.getTime() + ADDRESS_WAIT_MS));
  });

  it("never returns another user's address", async () => {
    const user = await seedFreelancer(db);
    const other = await seedFreelancer(db);
    const row = await insertSavedAddress(db, user.id, { label: "Binance", address: ADDR }, NOW);
    const later = new Date(NOW.getTime() + 2 * ADDRESS_WAIT_MS);
    expect(await usableSavedAddress(db, other.id, row.id, later)).toBeNull();
    expect(await removeSavedAddress(db, other.id, row.id, later)).toBe(false);
    expect(await listSavedAddresses(db, other.id)).toEqual([]);
    expect(await usableSavedAddress(db, user.id, row.id, later)).not.toBeNull();
  });

  it("lists oldest first", async () => {
    const user = await seedFreelancer(db);
    const b = "0x3333333333333333333333333333333333333333" as Address;
    await insertSavedAddress(db, user.id, { label: "B", address: b }, new Date(NOW.getTime() + 1000));
    await insertSavedAddress(db, user.id, { label: "A", address: ADDR }, NOW);
    expect((await listSavedAddresses(db, user.id)).map((r) => r.label)).toEqual(["A", "B"]);
  });
});
