import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { invoices, users, type InvoiceRow } from "@/lib/db/schema";

/** An invoice to insert; its id is generated and its number comes from the owner's counter. */
export type NewInvoice = Omit<typeof invoices.$inferInsert, "id" | "number">;

/**
 * Inserts an invoice with its owner's next number. Call it inside a transaction: the counter update
 * locks the user row, which serialises one freelancer's inserts. With `skipExistingPeriod`, a recurring
 * period that already exists inserts nothing; the number is given back so numbers stay gapless, and the
 * result is undefined.
 */
export async function insertNumberedInvoice(
  tx: Db,
  values: NewInvoice,
  opts: { skipExistingPeriod?: boolean } = {},
): Promise<InvoiceRow | undefined> {
  const [{ number }] = await tx
    .update(users)
    .set({ invoiceSeq: sql`${users.invoiceSeq} + 1` })
    .where(eq(users.id, values.userId))
    .returning({ number: users.invoiceSeq });
  const insert = tx.insert(invoices).values({ ...values, number });
  const [row] = opts.skipExistingPeriod
    ? await insert.onConflictDoNothing({ target: [invoices.recurringId, invoices.periodStart] }).returning()
    : await insert.returning();
  if (!row) {
    // Safe: this transaction still holds the user row lock, so no other insert took a later number.
    await tx
      .update(users)
      .set({ invoiceSeq: sql`${users.invoiceSeq} - 1` })
      .where(eq(users.id, values.userId));
  }
  return row;
}
