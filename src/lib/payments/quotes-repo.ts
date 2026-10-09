import { and, eq, lte } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { invoiceQuotes, type InvoiceQuoteRow } from "@/lib/db/schema";
import type { PayAsset } from "@/lib/money/currencies";
import type { InvoiceQuote } from "./quote";

export const QUOTE_TTL_MS = 10 * 60 * 1000;

export interface LockedQuote {
  asset: PayAsset;
  amountAtomic: bigint;
  rate: string;
  expiresAt: Date;
}

function toLocked(row: InvoiceQuoteRow): LockedQuote {
  return { asset: row.asset, amountAtomic: BigInt(row.amountAtomic), rate: row.rate, expiresAt: row.expiresAt };
}

/**
 * Spec §9: the 402 response and the paid retry must price the same amount, so a quote is locked
 * per (invoice, asset) for 10 minutes. `compute` runs only when there is no live lock.
 */
export async function lockQuote(
  db: Db,
  input: { invoiceId: string; asset: PayAsset; now: Date; compute: () => InvoiceQuote | Promise<InvoiceQuote> },
): Promise<LockedQuote> {
  const where = and(eq(invoiceQuotes.invoiceId, input.invoiceId), eq(invoiceQuotes.asset, input.asset));
  const [current] = await db.select().from(invoiceQuotes).where(where);
  if (current && current.expiresAt > input.now) return toLocked(current);

  const fresh = await input.compute();
  const values = {
    amountAtomic: fresh.amountAtomic.toString(),
    rate: fresh.rate,
    expiresAt: new Date(input.now.getTime() + QUOTE_TTL_MS),
    createdAt: input.now,
  };
  const [written] = await db
    .insert(invoiceQuotes)
    .values({ invoiceId: input.invoiceId, asset: input.asset, ...values })
    .onConflictDoUpdate({
      target: [invoiceQuotes.invoiceId, invoiceQuotes.asset],
      set: values,
      setWhere: lte(invoiceQuotes.expiresAt, input.now),
    })
    .returning();
  if (written) return toLocked(written);

  // Another request locked a live quote between our read and our write: everyone uses theirs.
  const [winner] = await db.select().from(invoiceQuotes).where(where);
  return toLocked(winner);
}
