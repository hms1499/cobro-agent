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
    treasuryStatus: row.wallet?.status ?? "missing",
    treasuryAddress: ready ? getAddress(row.wallet!.address!) : null,
    localCurrency: row.localCurrency ?? null,
  };
}
