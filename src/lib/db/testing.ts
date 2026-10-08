import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

/** In-memory Postgres with the real migrations. Create once per test file; resetDb between tests. */
export async function createTestDb(): Promise<Db> {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as Db;
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE users, treasury_wallets, rules, recurring_invoices, invoices, invoice_quotes, payments CASCADE`,
  );
}

export const TEST_TREASURY = "0x1111111111111111111111111111111111111111";

/** A signed-up, onboarded freelancer with a ready treasury wallet unless told otherwise. */
export async function seedFreelancer(
  db: Db,
  opts: { localCurrency?: "ARS" | "BRL"; treasuryAddress?: string | null; displayName?: string } = {},
): Promise<schema.UserRow> {
  const [user] = await db
    .insert(schema.users)
    .values({
      paraUserId: `para-${crypto.randomUUID()}`,
      email: "ana@example.com",
      displayName: opts.displayName ?? "Ana Diseño",
    })
    .returning();
  const address = opts.treasuryAddress === undefined ? TEST_TREASURY : opts.treasuryAddress;
  await db.insert(schema.treasuryWallets).values({
    userId: user.id,
    status: address ? "ready" : "creating",
    paraWalletId: address ? "para-wallet-1" : null,
    address,
  });
  await db.insert(schema.rules).values({ userId: user.id, localCurrency: opts.localCurrency ?? "ARS" });
  return user;
}

/** An open one-off invoice for 300.00 USD unless overridden. */
export async function seedInvoice(
  db: Db,
  userId: string,
  overrides: Partial<typeof schema.invoices.$inferInsert> = {},
): Promise<schema.InvoiceRow> {
  const [row] = await db
    .insert(schema.invoices)
    .values({
      slug: `s${crypto.randomUUID().replaceAll("-", "").slice(0, 9)}`,
      userId,
      clientName: "Acme",
      description: "Logo",
      amount: "300",
      currency: "USD",
      ...overrides,
    })
    .returning();
  return row;
}
