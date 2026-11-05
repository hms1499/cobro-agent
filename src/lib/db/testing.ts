import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { insertNumberedInvoice, type NewInvoice } from "@/lib/invoices/numbering";
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
    sql`TRUNCATE users, treasury_wallets, rules, recurring_invoices, invoices, invoice_quotes, payments, fx_intents, fx_trades, treasury_txs, agent_events, wallet_locks, withdrawal_addresses, email_codes CASCADE`,
  );
}

/**
 * The same database, except that `gap` runs once just before the wallet lock's insert executes: for tests of what a
 * run does when a row changes between its first read and the lock.
 */
export function withGapBeforeLock(db: Db, gap: () => Promise<unknown>): Db {
  let ran = false;
  const beforeExecuting = <T extends object>(query: T): T =>
    new Proxy(query, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        if (key !== "then") return (...args: unknown[]) => beforeExecuting(value.apply(target, args));
        return async (...args: unknown[]) => {
          if (!ran) {
            ran = true;
            await gap();
          }
          return value.apply(target, args);
        };
      },
    });
  return new Proxy(db, {
    get(target, key) {
      if (key !== "insert") return Reflect.get(target, key);
      return (table: Parameters<Db["insert"]>[0]) => (table === schema.walletLocks ? beforeExecuting(target.insert(table)) : target.insert(table));
    },
  });
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
  overrides: Partial<NewInvoice> = {},
): Promise<schema.InvoiceRow> {
  const row = await insertNumberedInvoice(db, {
    slug: `s${crypto.randomUUID().replaceAll("-", "").slice(0, 9)}`,
    userId,
    clientName: "Acme",
    description: "Logo",
    amount: "300",
    currency: "USD",
    ...overrides,
  });
  return row!;
}
