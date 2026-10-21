import { eq } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { Db } from "@/lib/db/client";
import { rules, treasuryWallets, users } from "@/lib/db/schema";
import type { LocalCurrency } from "@/lib/money/currencies";

export interface AppUser {
  id: string;
  email: string | null;
  displayName: string | null;
  treasuryStatus: "missing" | "creating" | "ready" | "failed";
  treasuryAddress: Address | null;
  /** The freelancer's own Para wallet, the only withdrawal destination (spec §6.1). */
  personalWallet: Address | null;
  /** Null until onboarding (Task 7) creates the rules row. */
  localCurrency: LocalCurrency | null;
}

export async function loadAppUser(db: Db, userId: string): Promise<AppUser | null> {
  const [row] = await db
    .select({ user: users, wallet: treasuryWallets, localCurrency: rules.localCurrency })
    .from(users)
    .leftJoin(treasuryWallets, eq(treasuryWallets.userId, users.id))
    .leftJoin(rules, eq(rules.userId, users.id))
    .where(eq(users.id, userId));
  if (!row) return null;
  const ready = row.wallet?.status === "ready" && row.wallet.address;
  return {
    id: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    // A retired (Para BETA) wallet can no longer be signed for; the app treats it like a failed one.
    treasuryStatus: row.wallet ? (row.wallet.status === "retired" ? "failed" : row.wallet.status) : "missing",
    treasuryAddress: ready ? getAddress(row.wallet!.address!) : null,
    personalWallet: row.user.personalWallet ? getAddress(row.user.personalWallet) : null,
    localCurrency: row.localCurrency ?? null,
  };
}

/** Whether onboarding is done (a rules row exists), by Para user id so sign-in can run it alongside the user upsert. */
export async function hasFinishedOnboarding(db: Db, paraUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: rules.userId })
    .from(users)
    .innerJoin(rules, eq(rules.userId, users.id))
    .where(eq(users.paraUserId, paraUserId))
    .limit(1);
  return row !== undefined;
}
