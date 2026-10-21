import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { Db } from "@/lib/db/client";
import { withdrawalAddresses, type WithdrawalAddressRow } from "@/lib/db/schema";
import { ADDRESS_WAIT_MS, type NewAddress } from "./validate";

export interface SavedAddress {
  id: string;
  label: string;
  address: Address;
  createdAt: Date;
  usableAt: Date;
}

function toSaved(row: WithdrawalAddressRow): SavedAddress {
  return { id: row.id, label: row.label, address: getAddress(row.address), createdAt: row.createdAt, usableAt: row.usableAt };
}

/** Active addresses, oldest first. */
export async function listSavedAddresses(db: Db, userId: string): Promise<SavedAddress[]> {
  const rows = await db
    .select()
    .from(withdrawalAddresses)
    .where(and(eq(withdrawalAddresses.userId, userId), isNull(withdrawalAddresses.removedAt)))
    .orderBy(asc(withdrawalAddresses.createdAt), asc(withdrawalAddresses.id));
  return rows.map(toSaved);
}

/** Saves the address; it can receive withdrawals only after ADDRESS_WAIT_MS. */
export async function insertSavedAddress(db: Db, userId: string, input: NewAddress, now: Date): Promise<SavedAddress> {
  const [row] = await db
    .insert(withdrawalAddresses)
    .values({
      userId,
      label: input.label,
      address: getAddress(input.address),
      createdAt: now,
      usableAt: new Date(now.getTime() + ADDRESS_WAIT_MS),
    })
    .returning();
  return toSaved(row);
}

/** Removal is immediate. False when the id is not an active address of this user. */
export async function removeSavedAddress(db: Db, userId: string, id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(withdrawalAddresses)
    .set({ removedAt: now })
    .where(and(eq(withdrawalAddresses.id, id), eq(withdrawalAddresses.userId, userId), isNull(withdrawalAddresses.removedAt)))
    .returning({ id: withdrawalAddresses.id });
  return rows.length === 1;
}

/** The address when it belongs to the user, is not removed and its wait is over at `now`. */
export async function usableSavedAddress(db: Db, userId: string, id: string, now: Date): Promise<SavedAddress | null> {
  const [row] = await db
    .select()
    .from(withdrawalAddresses)
    .where(
      and(
        eq(withdrawalAddresses.id, id),
        eq(withdrawalAddresses.userId, userId),
        isNull(withdrawalAddresses.removedAt),
        lte(withdrawalAddresses.usableAt, now),
      ),
    );
  return row ? toSaved(row) : null;
}

export function isUsable(a: SavedAddress, now: Date): boolean {
  return a.usableAt.getTime() <= now.getTime();
}
