import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { rules } from "@/lib/db/schema";
import type { FieldErrors, FormResult } from "@/lib/forms";
import type { ReferenceRates } from "@/lib/fx/rates";
import { isHomeCurrency, isLocalCurrency, type FiatCurrency, type HomeCurrency } from "@/lib/money/currencies";
import { parseFiatInput } from "@/lib/money/input";
import type { TreasuryBalances } from "@/lib/treasury/balances";
import { MIN_NOTIONAL_WAD } from "@/lib/treasury/engine";
import { cancelProposals, logEvent } from "@/lib/treasury/repo";
import { LOCAL_ASSET, tokenFiatAmount, usdWad } from "@/lib/treasury/value";

export interface HomeCurrencyInput {
  home: HomeCurrency;
  /** "0" for USD: a dollars freelancer keeps no spending reserve. */
  reserveAmount: string;
}
export type HomeCurrencyField = "home" | "reserveAmount";

/** The Settings currency form (USD home currency spec §4.3). Pesos and reais need a reserve; USD ignores it. */
export function parseHomeCurrencyForm(fields: Record<string, string>): FormResult<HomeCurrencyInput, HomeCurrencyField> {
  const errors: FieldErrors<HomeCurrencyField> = {};
  const home = fields.home;
  if (!isHomeCurrency(home)) errors.home = "settings.currencyError";
  if (home === "USD") return { ok: true, data: { home, reserveAmount: "0" } };
  const reserve = parseFiatInput((fields.reserveAmount ?? "").trim(), { allowZero: true });
  if (!reserve.ok) errors.reserveAmount = `money.error.${reserve.error}`;
  if (Object.keys(errors).length > 0 || !isHomeCurrency(home) || !reserve.ok) return { ok: false, errors };
  return { ok: true, data: { home, reserveAmount: reserve.value } };
}

export interface SwitchConsequences {
  /** Balances the agent will sell for USD₮ after the switch (each worth at least US$1). */
  converts: { asset: "WARS" | "WBRL"; amount: string; currency: FiatCurrency }[];
}

/**
 * What a switch to `to` sets in motion, for the warning shown before it is saved (spec §2.5): every
 * peso/real balance that is not `to`'s spending token becomes "save in dollars". Unknown without rates.
 */
export function switchConsequences(to: HomeCurrency, balances: TreasuryBalances, rates: ReferenceRates | null): SwitchConsequences {
  if (!rates) return { converts: [] };
  const keep = isLocalCurrency(to) ? LOCAL_ASSET[to] : null;
  const converts = (["WARS", "WBRL"] as const)
    .filter((asset) => asset !== keep && usdWad(asset, balances[asset], rates) >= MIN_NOTIONAL_WAD)
    .map((asset) => ({ asset, ...tokenFiatAmount(asset, balances[asset]) }));
  return { converts };
}

/**
 * Saves the home currency and reserve. A real change also cancels proposals made under the old
 * currency (as pausing does) and leaves a line in the agent's history.
 */
export async function changeHomeCurrency(db: Db, userId: string, input: HomeCurrencyInput, now: Date): Promise<{ changed: boolean }> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ home: rules.localCurrency }).from(rules).where(eq(rules.userId, userId));
    if (!current) throw new Error("No rules to change: onboarding is not done");
    await tx
      .update(rules)
      .set({ localCurrency: input.home, reserveAmount: input.reserveAmount, updatedAt: now })
      .where(eq(rules.userId, userId));
    if (current.home === input.home) return { changed: false };
    await cancelProposals(tx, userId, now);
    await logEvent(tx, userId, "home_currency_changed", { from: current.home, to: input.home }, now);
    return { changed: true };
  });
}
