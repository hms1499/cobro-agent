import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { Db } from "@/lib/db/client";
import {
  agentEvents,
  fxIntents,
  fxTrades,
  rules,
  treasuryTxs,
  treasuryWallets,
  users,
  walletLocks,
  type AgentEventRow,
  type AgentEventType,
  type FxIntentRow,
  type FxTradeRow,
  type RulesRow,
  type TreasuryTxRow,
} from "@/lib/db/schema";
import { DAY_MS } from "@/lib/invoices/dates";
import type { IntentPlan } from "./engine";

/** Longer than one run (RFQ ≤ 75 s, a few receipts); a killed run's lock frees itself after this. */
export const LOCK_TTL_MS = 5 * 60 * 1000;

/** Spec §10.4 step 1: true when `holder` now owns the wallet's lock (it was free or had expired). */
export async function acquireWalletLock(db: Db, walletId: string, holder: string, now: Date, ttlMs = LOCK_TTL_MS): Promise<boolean> {
  const lockedUntil = new Date(now.getTime() + ttlMs);
  const rows = await db
    .insert(walletLocks)
    .values({ walletId, holder, lockedUntil })
    .onConflictDoUpdate({ target: walletLocks.walletId, set: { holder, lockedUntil }, setWhere: lt(walletLocks.lockedUntil, now) })
    .returning({ holder: walletLocks.holder });
  return rows.length === 1 && rows[0].holder === holder;
}

export async function releaseWalletLock(db: Db, walletId: string, holder: string): Promise<void> {
  await db.delete(walletLocks).where(and(eq(walletLocks.walletId, walletId), eq(walletLocks.holder, holder)));
}

export interface TreasuryContext {
  userId: string;
  walletId: string;
  address: Address;
  paraWalletId: string;
  /** The only withdrawal destination (spec §6.1); null until Para reports the user's wallet. */
  personalWallet: Address | null;
  rules: RulesRow;
}

export async function loadTreasuryContext(db: Db, userId: string): Promise<TreasuryContext | null> {
  const [row] = await db
    .select({ wallet: treasuryWallets, rules, personalWallet: users.personalWallet })
    .from(treasuryWallets)
    .innerJoin(users, eq(users.id, treasuryWallets.userId))
    .innerJoin(rules, eq(rules.userId, treasuryWallets.userId))
    .where(and(eq(treasuryWallets.userId, userId), eq(treasuryWallets.status, "ready")));
  if (!row?.wallet.address || !row.wallet.paraWalletId) return null;
  return {
    userId,
    walletId: row.wallet.id,
    address: getAddress(row.wallet.address),
    paraWalletId: row.wallet.paraWalletId,
    personalWallet: row.personalWallet ? getAddress(row.personalWallet) : null,
    rules: row.rules,
  };
}

/** The users a cron run visits: onboarded, agent switched on, wallet ready. */
export async function listTreasuryUsers(db: Db): Promise<string[]> {
  const rows = await db
    .select({ userId: rules.userId })
    .from(rules)
    .innerJoin(treasuryWallets, eq(treasuryWallets.userId, rules.userId))
    .where(and(eq(rules.enabled, true), eq(treasuryWallets.status, "ready")))
    .orderBy(asc(rules.userId));
  return rows.map((row) => row.userId);
}

const OPEN_STATUSES: ("waiting" | "executing")[] = ["waiting", "executing"];

export async function openIntent(db: Db, userId: string): Promise<FxIntentRow | null> {
  const [row] = await db
    .select()
    .from(fxIntents)
    .where(and(eq(fxIntents.userId, userId), inArray(fxIntents.status, OPEN_STATUSES)));
  return row ?? null;
}

export async function intentById(db: Db, id: string): Promise<FxIntentRow | null> {
  const [row] = await db.select().from(fxIntents).where(eq(fxIntents.id, id));
  return row ?? null;
}

export async function cancelIntent(db: Db, id: string, now: Date): Promise<void> {
  await db
    .update(fxIntents)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(fxIntents.id, id), inArray(fxIntents.status, OPEN_STATUSES)));
}

/** Applies a convert plan: cancel the old intent, keep it (new amount, same age) or create a new one. */
export async function saveIntent(
  db: Db,
  userId: string,
  plan: Extract<IntentPlan, { action: "convert" }>,
  now: Date,
): Promise<FxIntentRow> {
  return db.transaction(async (tx) => {
    if (plan.cancel) await cancelIntent(tx, plan.cancel, now);
    const fields = { amountAtomic: plan.decision.amount.toString(), reason: plan.decision.reason, updatedAt: now };
    if (plan.keep) {
      // "executing" left behind by a crashed run goes back to waiting; its age is kept.
      const [kept] = await tx
        .update(fxIntents)
        .set({ ...fields, status: "waiting" })
        .where(and(eq(fxIntents.id, plan.keep), inArray(fxIntents.status, OPEN_STATUSES)))
        .returning();
      if (kept) return kept;
    }
    const [created] = await tx
      .insert(fxIntents)
      .values({ ...fields, userId, fromAsset: plan.decision.from, toAsset: plan.decision.to, createdAt: now })
      .returning();
    return created;
  });
}

export async function updateIntent(
  db: Db,
  id: string,
  fields: Partial<Pick<typeof fxIntents.$inferInsert, "status" | "attempts" | "lastSlippageBps" | "retryAfter">>,
  now: Date,
): Promise<void> {
  await db.update(fxIntents).set({ ...fields, updatedAt: now }).where(eq(fxIntents.id, id));
}

export async function insertTrade(db: Db, row: typeof fxTrades.$inferInsert): Promise<FxTradeRow> {
  const [trade] = await db.insert(fxTrades).values(row).returning();
  return trade;
}

export async function updateTrade(db: Db, id: string, fields: Partial<typeof fxTrades.$inferInsert>): Promise<void> {
  await db.update(fxTrades).set(fields).where(eq(fxTrades.id, id));
}

export async function tradeBySwapHash(db: Db, hash: string): Promise<FxTradeRow | null> {
  const [row] = await db.select().from(fxTrades).where(eq(fxTrades.swapTxHash, hash));
  return row ?? null;
}

/** Notional of swaps broadcast or filled in the rolling 24 hours, as a USD wad (spec §10.1 dailyMaxUsd). */
export async function filledUsdWad24h(db: Db, userId: string, now: Date): Promise<bigint> {
  const [row] = await db
    .select({ cents: sql`coalesce(sum(${fxTrades.notionalUsdCents}), 0)`.mapWith(String) })
    .from(fxTrades)
    .where(
      and(
        eq(fxTrades.userId, userId),
        inArray(fxTrades.status, ["broadcast", "filled"]),
        gt(fxTrades.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  return BigInt(row.cents) * 10n ** 16n;
}

export async function logEvent(
  db: Db,
  userId: string,
  type: AgentEventType,
  data: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await db.insert(agentEvents).values({ userId, type, data, createdAt: now });
}

export async function listEvents(db: Db, userId: string, limit = 20): Promise<AgentEventRow[]> {
  return db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.userId, userId))
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(limit);
}

/** The user's most recent event of `type`; ties on createdAt are broken by id so the answer is stable. */
export async function lastEvent(db: Db, userId: string, type: AgentEventType): Promise<AgentEventRow | null> {
  const [row] = await db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.userId, userId), eq(agentEvents.type, type)))
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
    .limit(1);
  return row ?? null;
}

export async function recordTreasuryTx(db: Db, row: typeof treasuryTxs.$inferInsert): Promise<void> {
  await db.insert(treasuryTxs).values(row);
}

export async function pendingTreasuryTxs(db: Db, userId: string): Promise<TreasuryTxRow[]> {
  return db
    .select()
    .from(treasuryTxs)
    .where(and(eq(treasuryTxs.userId, userId), eq(treasuryTxs.status, "pending")))
    .orderBy(asc(treasuryTxs.nonce));
}

export async function settleTreasuryTx(db: Db, hash: string, status: "success" | "reverted", now: Date): Promise<void> {
  await db
    .update(treasuryTxs)
    .set({ status, confirmedAt: now })
    .where(and(eq(treasuryTxs.hash, hash), eq(treasuryTxs.status, "pending")));
}
