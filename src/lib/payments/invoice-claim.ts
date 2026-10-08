import { and, eq, lt, or } from "drizzle-orm";
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
      and(
        eq(invoices.id, invoiceId),
        or(eq(invoices.status, "open"), and(eq(invoices.status, "settling"), lt(invoices.settlingUntil, now))),
      ),
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
  p: { invoiceId: string; payer: string; asset: PayAsset; amountAtomic: bigint; txHash: string; now: Date },
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
      })
      .onConflictDoNothing({ target: payments.txHash });
    await tx.update(invoices).set({ status: "paid", paidAt: p.now, settlingUntil: null }).where(eq(invoices.id, p.invoiceId));
  });
}
