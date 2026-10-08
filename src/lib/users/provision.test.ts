import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { treasuryWallets, users } from "@/lib/db/schema";
import { createTestDb, resetDb } from "@/lib/db/testing";
import { ParaRestError, type ParaWallet } from "@/lib/signer/para-rest";
import { ensureTreasuryWallet, upsertUser, type TreasuryWalletProvider } from "./provision";

const ADDRESS = "0x2222222222222222222222222222222222222222";

function fakeProvider(overrides: Partial<TreasuryWalletProvider> = {}) {
  return {
    createWallet: vi.fn(async (): Promise<ParaWallet> => ({ id: "para-w1", type: "EVM", status: "creating" })),
    waitUntilReady: vi.fn(
      async (id: string): Promise<ParaWallet> => ({ id, type: "EVM", status: "ready", address: ADDRESS }),
    ),
    findWalletByCustomId: vi.fn(async (): Promise<ParaWallet | null> => null),
    ...overrides,
  };
}

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const session = { paraUserId: "para-123", email: "ana@example.com", expiresAt: 0 };

async function walletRow(userId: string) {
  const [row] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, userId));
  return row;
}

describe("upsertUser", () => {
  it("creates the user once and keeps known fields when a later token omits them", async () => {
    const first = await upsertUser(db, { ...session, evmAddress: "0x3333333333333333333333333333333333333333" });
    const second = await upsertUser(db, { paraUserId: "para-123", expiresAt: 0 });
    expect(second.id).toBe(first.id);
    expect(second.email).toBe("ana@example.com");
    expect(second.personalWallet).toBe("0x3333333333333333333333333333333333333333");
    expect(await db.select().from(users)).toHaveLength(1);
  });
});

describe("ensureTreasuryWallet", () => {
  it("creates one app-owned wallet keyed by our user id", async () => {
    const user = await upsertUser(db, session);
    const provider = fakeProvider();
    const state = await ensureTreasuryWallet(db, user.id, provider);
    expect(state).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.createWallet).toHaveBeenCalledWith(user.id);
    expect(await walletRow(user.id)).toMatchObject({ status: "ready", paraWalletId: "para-w1", address: ADDRESS });
  });

  it("does nothing when the wallet is already ready", async () => {
    const user = await upsertUser(db, session);
    await ensureTreasuryWallet(db, user.id, fakeProvider());
    const provider = fakeProvider();
    expect(await ensureTreasuryWallet(db, user.id, provider)).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.createWallet).not.toHaveBeenCalled();
  });

  it("creates exactly one wallet when two sign-ins race", async () => {
    const user = await upsertUser(db, session);
    const provider = fakeProvider();
    const states = await Promise.all([
      ensureTreasuryWallet(db, user.id, provider),
      ensureTreasuryWallet(db, user.id, provider),
    ]);
    expect(provider.createWallet).toHaveBeenCalledTimes(1);
    expect(states.map((s) => s.status)).toContain("ready");
  });

  it("marks a failed creation and resumes it with the same Para wallet next time", async () => {
    const user = await upsertUser(db, session);
    const failing = fakeProvider({
      waitUntilReady: vi.fn(async () => {
        throw new Error("Para timeout");
      }),
    });
    await expect(ensureTreasuryWallet(db, user.id, failing)).rejects.toThrow("Para timeout");
    expect(await walletRow(user.id)).toMatchObject({ status: "failed", paraWalletId: "para-w1" });

    const provider = fakeProvider();
    expect(await ensureTreasuryWallet(db, user.id, provider)).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.createWallet).not.toHaveBeenCalled();
    expect(provider.waitUntilReady).toHaveBeenCalledWith("para-w1");
  });

  it("leaves a fresh creation alone but takes over one that died", async () => {
    const user = await upsertUser(db, session);
    const now = new Date("2026-10-15T12:00:00Z");
    await db.insert(treasuryWallets).values({ userId: user.id, status: "creating", updatedAt: new Date("2026-10-15T11:59:30Z") });
    const provider = fakeProvider();
    expect(await ensureTreasuryWallet(db, user.id, provider, now)).toEqual({ status: "creating" });
    expect(provider.createWallet).not.toHaveBeenCalled();

    const later = new Date("2026-10-15T12:03:00Z");
    expect(await ensureTreasuryWallet(db, user.id, provider, later)).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.createWallet).toHaveBeenCalledTimes(1);
  });

  it("adopts the wallet Para already created when a dead request never stored its id", async () => {
    const user = await upsertUser(db, session);
    await db.insert(treasuryWallets).values({ userId: user.id, status: "creating", updatedAt: new Date("2026-10-15T11:50:00Z") });
    const provider = fakeProvider({
      createWallet: vi.fn(async () => {
        throw new ParaRestError(409, "WALLET_ALREADY_EXISTS", "a wallet for this identifier and type already exists");
      }),
      findWalletByCustomId: vi.fn(async (): Promise<ParaWallet> => ({ id: "para-existing", type: "EVM", status: "creating" })),
    });
    const state = await ensureTreasuryWallet(db, user.id, provider, new Date("2026-10-15T12:00:00Z"));
    expect(state).toEqual({ status: "ready", address: ADDRESS });
    expect(provider.findWalletByCustomId).toHaveBeenCalledWith(user.id);
    expect(provider.waitUntilReady).toHaveBeenCalledWith("para-existing");
    expect(await walletRow(user.id)).toMatchObject({ status: "ready", paraWalletId: "para-existing", address: ADDRESS });
  });

  it("does not look up a wallet for other creation errors", async () => {
    const user = await upsertUser(db, session);
    const provider = fakeProvider({
      createWallet: vi.fn(async () => {
        throw new ParaRestError(500, "INTERNAL_ERROR", "boom");
      }),
    });
    await expect(ensureTreasuryWallet(db, user.id, provider)).rejects.toThrow("boom");
    expect(provider.findWalletByCustomId).not.toHaveBeenCalled();
    expect(await walletRow(user.id)).toMatchObject({ status: "failed", paraWalletId: null });
  });
});
