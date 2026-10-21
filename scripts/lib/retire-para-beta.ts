import { and, eq, inArray, lt, ne } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { fxIntents, invoices, recurringInvoices, rules, treasuryTxs, treasuryWallets, users } from "@/lib/db/schema";

export interface RetireSummary {
  /** treasury_wallets set to "retired". */
  wallets: number;
  /** rules.enabled true to false. */
  rulesDisabled: number;
  /** recurring_invoices.active true to false. */
  recurringStopped: number;
  /** invoices "open" to "cancelled". */
  invoicesCancelled: number;
  /** Non-empty means nothing was written. */
  blockers: string[];
}

/** Ids of the users created before the cutoff: the only users this script ever touches. */
export async function usersCreatedBefore(db: Db, createdBefore: Date): Promise<{ id: string; email: string | null }[]> {
  return db.select({ id: users.id, email: users.email }).from(users).where(lt(users.createdAt, createdBefore));
}

/** Thrown inside the write transaction to roll it back when money is in flight. */
class BlockedError extends Error {
  constructor(readonly blockers: string[]) {
    super("blocked");
  }
}

/** Money in flight for these users. One source of truth for the pre-check and the in-transaction re-check. */
async function findBlockers(h: Pick<Db, "select">, ids: string[]): Promise<string[]> {
  const settling = await h
    .select({ slug: invoices.slug })
    .from(invoices)
    .where(and(inArray(invoices.userId, ids), eq(invoices.status, "settling")));
  const pendingTxs = await h
    .select({ id: treasuryTxs.id })
    .from(treasuryTxs)
    .where(and(inArray(treasuryTxs.userId, ids), eq(treasuryTxs.status, "pending")));
  const executing = await h
    .select({ id: fxIntents.id })
    .from(fxIntents)
    .where(and(inArray(fxIntents.userId, ids), eq(fxIntents.status, "executing")));
  return [
    ...settling.map((r) => `invoice ${r.slug} is settling`),
    ...pendingTxs.map((r) => `treasury tx ${r.id} is pending`),
    ...executing.map((r) => `fx intent ${r.id} is executing`),
  ];
}

/**
 * Takes Para BETA users out of every money path without deleting anything: wallets become "retired",
 * rules and recurring templates stop, open invoices are cancelled. Paid and cancelled invoices, trades,
 * payments and transactions are never touched. Refuses (writes nothing) while money is in flight.
 */
export async function retireParaBetaData(
  db: Db,
  opts: {
    createdBefore: Date;
    apply: boolean;
    /** Test seam: runs after the pre-check and before the write transaction, so a test can simulate a payer claiming an invoice in that gap. */
    onBeforeTransaction?: () => Promise<void>;
  },
): Promise<RetireSummary> {
  const ids = (await usersCreatedBefore(db, opts.createdBefore)).map((u) => u.id);
  const summary: RetireSummary = { wallets: 0, rulesDisabled: 0, recurringStopped: 0, invoicesCancelled: 0, blockers: [] };
  if (ids.length === 0) return summary;

  summary.blockers = await findBlockers(db, ids);

  const walletWhere = and(inArray(treasuryWallets.userId, ids), ne(treasuryWallets.status, "retired"));
  const rulesWhere = and(inArray(rules.userId, ids), eq(rules.enabled, true));
  const recurringWhere = and(inArray(recurringInvoices.userId, ids), eq(recurringInvoices.active, true));
  const invoicesWhere = and(inArray(invoices.userId, ids), eq(invoices.status, "open"));

  if (!opts.apply || summary.blockers.length > 0) {
    summary.wallets = (await db.select({ id: treasuryWallets.id }).from(treasuryWallets).where(walletWhere)).length;
    summary.rulesDisabled = (await db.select({ id: rules.userId }).from(rules).where(rulesWhere)).length;
    summary.recurringStopped = (await db.select({ id: recurringInvoices.id }).from(recurringInvoices).where(recurringWhere)).length;
    summary.invoicesCancelled = (await db.select({ id: invoices.id }).from(invoices).where(invoicesWhere)).length;
    return summary;
  }

  await opts.onBeforeTransaction?.();

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      // Cancel open invoices first, then re-check: a payer who claimed one (open to settling) after the
      // pre-check is not cancelled here and shows up as a blocker, which rolls everything back.
      summary.invoicesCancelled = (
        await tx.update(invoices).set({ status: "cancelled" }).where(invoicesWhere).returning({ id: invoices.id })
      ).length;
      const late = await findBlockers(tx, ids);
      if (late.length > 0) throw new BlockedError(late);
      summary.wallets = (
        await tx.update(treasuryWallets).set({ status: "retired", updatedAt: now }).where(walletWhere).returning({ id: treasuryWallets.id })
      ).length;
      summary.rulesDisabled = (
        await tx.update(rules).set({ enabled: false, updatedAt: now }).where(rulesWhere).returning({ id: rules.userId })
      ).length;
      summary.recurringStopped = (
        await tx.update(recurringInvoices).set({ active: false }).where(recurringWhere).returning({ id: recurringInvoices.id })
      ).length;
    });
  } catch (error) {
    if (!(error instanceof BlockedError)) throw error;
    return { wallets: 0, rulesDisabled: 0, recurringStopped: 0, invoicesCancelled: 0, blockers: error.blockers };
  }
  return summary;
}
