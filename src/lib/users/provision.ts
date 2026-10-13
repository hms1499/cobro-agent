import { and, eq, lt, or, sql } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { ParaSession } from "@/lib/auth/para-jwt";
import type { Db } from "@/lib/db/client";
import { treasuryWallets, users, type UserRow } from "@/lib/db/schema";
import { ParaRestError, type ParaWallet } from "@/lib/signer/para-rest";

/** ParaRestClient satisfies this; tests pass a fake. */
export interface TreasuryWalletProvider {
  createWallet(customId: string): Promise<ParaWallet>;
  waitUntilReady(walletId: string): Promise<ParaWallet>;
  /** Finds the wallet Para already holds for this custom id (adopted after a lost row or a lost wallet id). */
  findWalletByCustomId(customId: string): Promise<ParaWallet | null>;
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
 * Spec §6.2 flow 1: one app-owned Para wallet per user. Its CUSTOM_ID is the Para user id (§15), so
 * email sign-in never claims it and a lost users row re-adopts it instead of orphaning its funds.
 * The row is inserted first as a claim, so concurrent sign-ins create one wallet.
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
      walletId = await adoptOrCreateWalletId(provider, await customIdFor(db, userId));
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

export function treasuryCustomId(paraUserId: string): string {
  return `para:${paraUserId}`;
}

async function customIdFor(db: Db, userId: string): Promise<string> {
  const [row] = await db.select({ paraUserId: users.paraUserId }).from(users).where(eq(users.id, userId));
  if (!row) throw new Error(`User ${userId} not found`);
  return treasuryCustomId(row.paraUserId);
}

/**
 * Adopt first: the wallet may exist from an earlier users row (§15). If Para still answers 409
 * WALLET_ALREADY_EXISTS (a race with another request), look it up once more.
 */
async function adoptOrCreateWalletId(provider: TreasuryWalletProvider, customId: string): Promise<string> {
  const existing = await provider.findWalletByCustomId(customId);
  if (existing) return existing.id;
  try {
    return (await provider.createWallet(customId)).id;
  } catch (error) {
    if (!(error instanceof ParaRestError) || error.status !== 409 || error.code !== "WALLET_ALREADY_EXISTS") throw error;
    const created = await provider.findWalletByCustomId(customId);
    if (!created) throw error;
    return created.id;
  }
}
