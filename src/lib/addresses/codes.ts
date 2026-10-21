import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { Db } from "@/lib/db/client";
import { emailCodes } from "@/lib/db/schema";
import type { EmailSender } from "@/lib/email/send";
import { addressAddedEmail, addressCodeEmail } from "./emails";
import { insertSavedAddress, listSavedAddresses, type SavedAddress } from "./repo";
import { safeErrorTag } from "./safe-error";
import { MAX_SAVED_ADDRESSES, type NewAddress } from "./validate";

export const CODE_TTL_MS = 600_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_COOLDOWN_MS = 60_000;
export const CODES_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CodeDeps {
  db: Db;
  now(): Date;
  /** The raw SESSION_SECRET string. */
  secret: string;
  send: EmailSender;
}

type CodeUser = { id: string; email: string | null };

function hashCode(secret: string, userId: string, code: string): string {
  return createHmac("sha256", secret).update(`address-code:${userId}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Postgres unique violation, bare or wrapped by drizzle. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** The code is bound to the label and address it was requested for. */
export async function requestAddressCode(
  deps: CodeDeps,
  user: CodeUser,
  pending: NewAddress,
): Promise<{ ok: true; expiresAt: Date } | { ok: false; error: "no_email" | "cooldown" | "daily_limit" | "send_failed" }> {
  if (!user.email) return { ok: false, error: "no_email" };
  const { db } = deps;
  const now = deps.now();

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  // Checks and insert run under a per-user advisory lock, so parallel requests are serialised and
  // the cooldown and daily cap hold. The send stays outside the transaction.
  // Rows count by created_at; a failed send deletes its row, so it never counts.
  const reserved = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`);
    const [latest] = await tx
      .select({ createdAt: emailCodes.createdAt })
      .from(emailCodes)
      .where(eq(emailCodes.userId, user.id))
      .orderBy(desc(emailCodes.createdAt))
      .limit(1);
    if (latest && latest.createdAt.getTime() > now.getTime() - CODE_COOLDOWN_MS) return { id: null, error: "cooldown" } as const;
    const [{ n }] = await tx
      .select({ n: count() })
      .from(emailCodes)
      .where(and(eq(emailCodes.userId, user.id), gt(emailCodes.createdAt, new Date(now.getTime() - DAY_MS))));
    if (n >= CODES_PER_DAY) return { id: null, error: "daily_limit" } as const;
    const [inserted] = await tx
      .insert(emailCodes)
      .values({
        userId: user.id,
        codeHash: hashCode(deps.secret, user.id, code),
        label: pending.label,
        address: getAddress(pending.address),
        expiresAt,
        createdAt: now,
      })
      .returning({ id: emailCodes.id });
    return { id: inserted.id, error: null } as const;
  });
  if (reserved.id === null) return { ok: false, error: reserved.error };
  const row = { id: reserved.id };

  try {
    const mail = addressCodeEmail(code, { label: pending.label, address: getAddress(pending.address) });
    await deps.send({ to: user.email, ...mail });
  } catch (err) {
    // Never log the address, email or code.
    console.error("address code email failed:", safeErrorTag(err));
    await db.delete(emailCodes).where(eq(emailCodes.id, row.id));
    return { ok: false, error: "send_failed" };
  }

  // Supersede only codes created before this one, and only once the new one is out, so a failed send keeps the old code.
  await db
    .update(emailCodes)
    .set({ expiresAt: now })
    .where(and(eq(emailCodes.userId, user.id), lt(emailCodes.createdAt, now), isNull(emailCodes.usedAt), gt(emailCodes.expiresAt, now)));
  return { ok: true, expiresAt };
}

/** A live code: unused, unexpired, with attempts left. The latest one wins. */
function liveCode(userId: string, now: Date) {
  return and(
    eq(emailCodes.userId, userId),
    isNull(emailCodes.usedAt),
    gt(emailCodes.expiresAt, now),
    lt(emailCodes.attempts, CODE_MAX_ATTEMPTS),
  );
}

export async function pendingAddressCode(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ label: string; address: Address; expiresAt: Date } | null> {
  const [row] = await db
    .select()
    .from(emailCodes)
    .where(liveCode(userId, now))
    .orderBy(desc(emailCodes.createdAt))
    .limit(1);
  return row ? { label: row.label, address: getAddress(row.address), expiresAt: row.expiresAt } : null;
}

/**
 * Every call on a live code counts as an attempt (one atomic UPDATE) before the comparison.
 * Right code: in one transaction the code is marked used and the address inserted. Beyond
 * `full`/`duplicate` checks, a unique-violation from a concurrent add is also reported as
 * `duplicate`. In those two cases the code is consumed (the transaction commits `used_at`).
 */
export async function confirmAddressCode(
  deps: CodeDeps,
  user: CodeUser,
  input: string,
): Promise<{ ok: true; address: SavedAddress } | { ok: false; error: "no_code" | "invalid" | "too_many" | "duplicate" | "full" }> {
  const { db } = deps;
  const now = deps.now();
  const [live] = await db
    .select({ id: emailCodes.id })
    .from(emailCodes)
    .where(liveCode(user.id, now))
    .orderBy(desc(emailCodes.createdAt))
    .limit(1);
  if (!live) return { ok: false, error: "no_code" };

  const [row] = await db
    .update(emailCodes)
    .set({ attempts: sql`${emailCodes.attempts} + 1` })
    .where(and(eq(emailCodes.id, live.id), isNull(emailCodes.usedAt), gt(emailCodes.expiresAt, now), lt(emailCodes.attempts, CODE_MAX_ATTEMPTS)))
    .returning();
  if (!row) return { ok: false, error: "no_code" };

  const digits = input.replace(/\s+/g, "");
  const matches = /^\d{6}$/.test(digits) && sameHash(hashCode(deps.secret, user.id, digits), row.codeHash);
  if (!matches) return { ok: false, error: row.attempts >= CODE_MAX_ATTEMPTS ? "too_many" : "invalid" };

  const pending: NewAddress = { label: row.label, address: getAddress(row.address) };
  const outcome = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    // Only one concurrent confirm can flip used_at.
    const claimed = await tx
      .update(emailCodes)
      .set({ usedAt: now })
      .where(and(eq(emailCodes.id, row.id), isNull(emailCodes.usedAt)))
      .returning({ id: emailCodes.id });
    if (claimed.length === 0) return { ok: false, error: "no_code" } as const;

    const saved = await listSavedAddresses(txDb, user.id);
    if (saved.some((s) => s.address === pending.address)) return { ok: false, error: "duplicate" } as const;
    if (saved.length >= MAX_SAVED_ADDRESSES) return { ok: false, error: "full" } as const;
    try {
      // A savepoint keeps the transaction usable (and used_at committed) if the unique index fires.
      const address = await tx.transaction((sp) => insertSavedAddress(sp as unknown as Db, user.id, pending, now));
      return { ok: true, address } as const;
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, error: "duplicate" } as const;
      throw err;
    }
  });
  if (!outcome.ok) return outcome;

  if (user.email) {
    try {
      await deps.send({ to: user.email, ...addressAddedEmail(outcome.address) });
    } catch (err) {
      console.error("address added notice failed:", safeErrorTag(err));
    }
  }
  return outcome;
}
