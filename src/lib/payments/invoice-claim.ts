import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { invoices, payments } from "@/lib/db/schema";
import type { PayAsset } from "@/lib/money/currencies";
import { PAYMENT_TIMEOUT_SECONDS } from "./network";

/**
 * Longer than the signed authorization stays valid on-chain (validBefore / Permit2 deadline), so after
 * an unknown settlement outcome no second payer can be charged while the first transfer can still land.
 */
export const SETTLING_HOLD_MS = (PAYMENT_TIMEOUT_SECONDS + 60) * 1000;

/** Spec §12 "no double charge": only the request that moves the invoice to "settling" may settle. */
export async function claimInvoice(db: Db, invoiceId: string, now: Date): Promise<boolean> {
  const claimed = await db
    .update(invoices)
    .set({ status: "settling", settlingUntil: new Date(now.getTime() + SETTLING_HOLD_MS) })
    .where(
      // A "settling" invoice stays busy until the reconciler resolves it (Plan 3 Task 16).
      and(eq(invoices.id, invoiceId), eq(invoices.status, "open")),
    )
    .returning({ id: invoices.id });
  return claimed.length === 1;
}

/** After a settlement that definitely failed. */
export async function releaseInvoice(db: Db, invoiceId: string): Promise<void> {
  await db
    .update(invoices)
    .set({ status: "open", settlingUntil: null })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "settling")));
}

export async function recordPayment(
  db: Db,
  p: { invoiceId: string; payer: string; asset: PayAsset; amountAtomic: bigint; txHash: string; now: Date; ratesSnapshot?: Record<string, string> | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(payments)
      .values({
        invoiceId: p.invoiceId,
        payer: p.payer,
        asset: p.asset,
        amountAtomic: p.amountAtomic.toString(),
        txHash: p.txHash,
        settledAt: p.now,
        ratesSnapshot: p.ratesSnapshot ?? null,
      })
      .onConflictDoNothing({ target: payments.txHash });
    await tx.update(invoices).set({ status: "paid", paidAt: p.now, settlingUntil: null }).where(eq(invoices.id, p.invoiceId));
  });
}

const GUARD_LOST = Symbol("reconcile guard lost");

/**
 * Reconcile path only: reopen the invoice only if it is still held by the claim we read.
 * Returns false when it moved on (a newer claim, or paid) in the meantime.
 */
export async function releaseSettling(db: Db, invoiceId: string, settlingUntil: Date): Promise<boolean> {
  const released = await db
    .update(invoices)
    .set({ status: "open", settlingUntil: null })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "settling"), eq(invoices.settlingUntil, settlingUntil)))
    .returning({ id: invoices.id });
  return released.length === 1;
}

/**
 * Reconcile path only: mark the invoice paid only if it is still held by the claim we read, and only
 * if this call inserted the payment row. "moved" = the invoice changed; "duplicate" = the transfer was
 * already recorded. Nothing is written in either case.
 */
export async function recordReconciledPayment(
  db: Db,
  p: { invoiceId: string; settlingUntil: Date; payer: string; asset: PayAsset; amountAtomic: bigint; txHash: string; now: Date },
): Promise<"recorded" | "moved" | "duplicate"> {
  try {
    return await db.transaction(async (tx) => {
      const moved = await tx
        .update(invoices)
        .set({ status: "paid", paidAt: p.now, settlingUntil: null })
        .where(and(eq(invoices.id, p.invoiceId), eq(invoices.status, "settling"), eq(invoices.settlingUntil, p.settlingUntil)))
        .returning({ id: invoices.id });
      if (moved.length === 0) return "moved" as const;
      const inserted = await tx
        .insert(payments)
        .values({
          invoiceId: p.invoiceId,
          payer: p.payer,
          asset: p.asset,
          amountAtomic: p.amountAtomic.toString(),
          txHash: p.txHash,
          settledAt: p.now,
          ratesSnapshot: null,
        })
        .onConflictDoNothing({ target: payments.txHash })
        .returning({ id: payments.id });
      if (inserted.length === 0) throw GUARD_LOST;
      return "recorded" as const;
    });
  } catch (error) {
    if (error === GUARD_LOST) return "duplicate";
    throw error;
  }
}
