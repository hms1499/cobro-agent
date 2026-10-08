import { and, eq, lt, or, sql } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { ParaSession } from "@/lib/auth/para-jwt";
import type { Db } from "@/lib/db/client";
import { treasuryWallets, users, type UserRow } from "@/lib/db/schema";
import type { ParaWallet } from "@/lib/signer/para-rest";

/** ParaRestClient satisfies this; tests pass a fake. */
export interface TreasuryWalletProvider {
  createWallet(userId: string): Promise<ParaWallet>;
  waitUntilReady(walletId: string): Promise<ParaWallet>;
}

export type TreasuryState = { status: "ready"; address: Address } | { status: "creating" };

/** A creation older than this is assumed dead (its request was killed) and may be taken over. */
export const STALE_CREATION_MS = 2 * 60 * 1000;

export async function upsertUser(db: Db, session: ParaSession): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({ paraUserId: session.paraUserId, email: session.email ?? null, personalWallet: session.evmAddress ?? null })
    .onConflictDoUpdate({
      target: users.paraUserId,
      set: {
        email: sql`coalesce(excluded.email, ${users.email})`,
        personalWallet: sql`coalesce(excluded.personal_wallet, ${users.personalWallet})`,
      },
    })
    .returning();
  return row;
}

/**
 * Spec §6.2 flow 1: one app-owned Para wallet per user (CUSTOM_ID = our user id, so email sign-in
 * never claims it). The row is inserted first as a claim, so concurrent sign-ins create one wallet.
 */
export async function ensureTreasuryWallet(
  db: Db,
  userId: string,
  provider: TreasuryWalletProvider,
  now = new Date(),
): Promise<TreasuryState> {
  const claimed = await db
    .insert(treasuryWallets)
    .values({ userId, status: "creating", updatedAt: now })
    .onConflictDoNothing({ target: treasuryWallets.userId })
    .returning({ id: treasuryWallets.id });
  if (claimed.length === 1) return createOrResume(db, userId, provider, null);

  const [row] = await db.select().from(treasuryWallets).where(eq(treasuryWallets.userId, userId));
  if (row.status === "ready" && row.address) return { status: "ready", address: getAddress(row.address) };

  const staleBefore = new Date(now.getTime() - STALE_CREATION_MS);
  const retaken = await db
    .update(treasuryWallets)
    .set({ status: "creating", updatedAt: now })
    .where(
      and(
        eq(treasuryWallets.userId, userId),
        or(
          eq(treasuryWallets.status, "failed"),
          and(eq(treasuryWallets.status, "creating"), lt(treasuryWallets.updatedAt, staleBefore)),
        ),
      ),
    )
    .returning({ paraWalletId: treasuryWallets.paraWalletId });
  if (retaken.length === 0) return { status: "creating" };
  return createOrResume(db, userId, provider, retaken[0].paraWalletId);
}

async function createOrResume(
  db: Db,
  userId: string,
  provider: TreasuryWalletProvider,
  existingWalletId: string | null,
): Promise<TreasuryState> {
  const mark = (fields: Partial<typeof treasuryWallets.$inferInsert>) =>
    db.update(treasuryWallets).set({ ...fields, updatedAt: new Date() }).where(eq(treasuryWallets.userId, userId));
  try {
    let walletId = existingWalletId;
    if (!walletId) {
      walletId = (await provider.createWallet(userId)).id;
      await mark({ paraWalletId: walletId });
    }
    const ready = await provider.waitUntilReady(walletId);
    if (!ready.address) throw new Error(`Para wallet ${walletId} is ready without an address`);
    const address = getAddress(ready.address);
    await mark({ status: "ready", address });
    return { status: "ready", address };
  } catch (error) {
    await mark({ status: "failed" });
    throw error;
  }
}
