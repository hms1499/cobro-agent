import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer } from "@/lib/db/testing";
import type { InvoiceInput } from "./input";
import { insertNumberedInvoice } from "./numbering";
import { cancelInvoice, createInvoice, createRecurring, issueDueRecurring, listInvoices } from "./repo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(async () => {
  await resetDb(db);
});

const input: InvoiceInput = {
  clientName: "Acme",
  description: "Logo",
  amount: "300.00",
  currency: "USD",
  dueDate: "2026-10-20",
  repeat: "none",
};
const NOW = new Date("2026-10-15T12:00:00Z");

async function seqOf(userId: string): Promise<number> {
  const [row] = await db.select({ seq: users.invoiceSeq }).from(users).where(eq(users.id, userId));
  return row.seq;
}

describe("stored invoice numbers", () => {
  it("starts a user without invoices at 1", async () => {
    const user = await seedFreelancer(db);
    const invoice = await createInvoice(db, user.id, input);
    expect(invoice.number).toBe(1);
    expect(await seqOf(user.id)).toBe(1);
  });

  it("numbers manual and recurring invoices from one sequence", async () => {
    const user = await seedFreelancer(db);
    expect((await createInvoice(db, user.id, input)).number).toBe(1);
    const { recurring, first } = await createRecurring(db, user.id, { ...input, repeat: "weekly" }, NOW);
    expect(first.number).toBe(2);
    expect(await issueDueRecurring(db, new Date(recurring.nextIssueAt.getTime() + 1000))).toBe(1);
    const numbers = (await listInvoices(db, user.id)).map((i) => i.number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3]);
    expect((await createInvoice(db, user.id, input)).number).toBe(4);
  });

  it("gives the number back when a recurring period already exists", async () => {
    const user = await seedFreelancer(db);
    const { recurring, first } = await createRecurring(db, user.id, { ...input, repeat: "weekly" }, NOW);
    const skipped = await db.transaction((tx) =>
      insertNumberedInvoice(
        tx as unknown as Db,
        {
          slug: "dup-period",
          userId: user.id,
          recurringId: recurring.id,
          periodStart: first.periodStart,
          clientName: "Acme",
          description: "Logo",
          amount: "300.00",
          currency: "USD",
        },
        { skipExistingPeriod: true },
      ),
    );
    expect(skipped).toBeUndefined();
    expect(await seqOf(user.id)).toBe(1);
    expect((await createInvoice(db, user.id, input)).number).toBe(2);
  });

  it("counts cancelled invoices in the sequence", async () => {
    const user = await seedFreelancer(db);
    const first = await createInvoice(db, user.id, input);
    expect(await cancelInvoice(db, user.id, first.id, NOW)).toBe("cancelled");
    expect((await createInvoice(db, user.id, input)).number).toBe(2);
  });

  it("keeps sequences independent per user", async () => {
    const a = await seedFreelancer(db);
    const b = await seedFreelancer(db);
    expect((await createInvoice(db, a.id, input)).number).toBe(1);
    expect((await createInvoice(db, b.id, input)).number).toBe(1);
    expect((await createInvoice(db, a.id, input)).number).toBe(2);
    expect((await createInvoice(db, b.id, input)).number).toBe(2);
  });

  it("rejects a duplicate number for the same user", async () => {
    const user = await seedFreelancer(db);
    await createInvoice(db, user.id, input);
    await expect(
      db.execute(
        sql`insert into invoices (slug, user_id, client_name, description, amount, currency, number) values ('dup', ${user.id}, 'Acme', 'Logo', 1, 'USD', 1)`,
      ),
    ).rejects.toThrow();
  });
});

describe("migration 0008", () => {
  /** A copy of the migrations folder that stops at `lastIdx`, so a database can be built at an older schema. */
  function migrationsUpTo(lastIdx: number): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cobro-mig-"));
    const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= lastIdx);
    fs.mkdirSync(path.join(dir, "meta"));
    fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) fs.copyFileSync(path.join("drizzle", `${entry.tag}.sql`), path.join(dir, `${entry.tag}.sql`));
    return dir;
  }

  it("backfill matches the old numbering, ties broken by id", async () => {
    const old = drizzle({ client: new PGlite() });
    await migrate(old, { migrationsFolder: migrationsUpTo(7) });

    const ids = { a: crypto.randomUUID(), b: crypto.randomUUID(), c: crypto.randomUUID() };
    for (const [key, id] of Object.entries(ids)) {
      await old.execute(sql`insert into users (id, para_user_id) values (${id}, ${`para-${key}`})`);
    }
    // User A: five invoices out of order, two sharing a created_at, one cancelled. User B: two. User C: none.
    const rows: [string, string, string?][] = [
      [ids.a, "2026-10-05T00:00:00Z"],
      [ids.a, "2026-10-01T00:00:00Z", "cancelled"],
      [ids.a, "2026-10-03T00:00:00Z"],
      [ids.a, "2026-10-03T00:00:00Z"],
      [ids.b, "2026-10-02T00:00:00Z"],
      [ids.a, "2026-10-09T00:00:00Z"],
      [ids.b, "2026-10-04T00:00:00Z"],
    ];
    for (const [i, [userId, createdAt, status]] of rows.entries()) {
      await old.execute(
        sql`insert into invoices (slug, user_id, client_name, description, amount, currency, status, created_at) values (${`s${i}`}, ${userId}, 'Acme', 'Logo', 100, 'USD', ${status ?? "open"}, ${createdAt})`,
      );
    }
    const expected = await old.execute<{ id: string; n: number }>(
      sql`select id, (select count(*) from invoices i2 where i2.user_id = invoices.user_id and (i2.created_at, i2.id) <= (invoices.created_at, invoices.id))::int as n from invoices order by id`,
    );

    await migrate(old, { migrationsFolder: "drizzle" });

    const actual = await old.execute<{ id: string; n: number }>(sql`select id, number as n from invoices order by id`);
    expect(actual.rows).toEqual(expected.rows);
    const seqs = await old.execute<{ id: string; seq: number }>(sql`select id, invoice_seq as seq from users`);
    expect(Object.fromEntries(seqs.rows.map((row) => [row.id, row.seq]))).toEqual({ [ids.a]: 5, [ids.b]: 2, [ids.c]: 0 });
    expect((await createInvoice(old as unknown as Db, ids.a, input)).number).toBe(6);
  });
});
