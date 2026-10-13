import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { rules, type RulesRow } from "@/lib/db/schema";
import type { FieldErrors, FormResult } from "@/lib/forms";
import { formatDecimal, parseDecimal } from "@/lib/money/decimal";
import { parseFiatInput } from "@/lib/money/input";

export type RulesField = "reserveAmount" | "maxSlippagePct" | "hardMaxSlippagePct" | "maxWaitHours" | "perTradeMaxUsd" | "dailyMaxUsd";

export interface RulesInput {
  reserveAmount: string;
  autoTopUp: boolean;
  maxSlippageBps: number;
  hardMaxSlippageBps: number;
  maxWaitMinutes: number;
  perTradeMaxUsd: number;
  dailyMaxUsd: number;
}

/** "0.5" or "0,5" → 50 basis points, at most two decimals; null when unreadable. */
function percentToBps(raw: string | undefined): number | null {
  const parsed = parseFiatInput(raw ?? "", { allowZero: true });
  return parsed.ok ? Number(parseDecimal(parsed.value, 2)) : null;
}

function wholeNumber(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  return /^\d{1,6}$/.test(text) ? Number(text) : null;
}

const within = (value: number | null, min: number, max: number): value is number => value !== null && value >= min && value <= max;

/** Spec §10.1 rules from the /app/rules form. Percentages become basis points, hours become minutes. */
export function parseRulesForm(fields: Record<string, string>): FormResult<RulesInput, RulesField> {
  const errors: FieldErrors<RulesField> = {};
  const rawReserve = (fields.reserveAmount ?? "").trim();
  const reserve = parseFiatInput(rawReserve === "" ? "0" : rawReserve, { allowZero: true });
  if (!reserve.ok) errors.reserveAmount = `money.error.${reserve.error}`;

  const maxSlippage = percentToBps(fields.maxSlippagePct);
  if (!within(maxSlippage, 5, 500)) errors.maxSlippagePct = "rules.error.slippage";
  const hardMax = percentToBps(fields.hardMaxSlippagePct);
  if (!within(hardMax, within(maxSlippage, 5, 500) ? maxSlippage : 5, 1000)) errors.hardMaxSlippagePct = "rules.error.hardSlippage";
  const waitHours = wholeNumber(fields.maxWaitHours);
  if (!within(waitHours, 0, 48)) errors.maxWaitHours = "rules.error.wait";
  const perTrade = wholeNumber(fields.perTradeMaxUsd);
  if (!within(perTrade, 1, 1000)) errors.perTradeMaxUsd = "rules.error.perTrade";
  const daily = wholeNumber(fields.dailyMaxUsd);
  if (!within(daily, within(perTrade, 1, 1000) ? perTrade : 1, 5000)) errors.dailyMaxUsd = "rules.error.daily";

  if (
    !reserve.ok ||
    Object.keys(errors).length > 0 ||
    maxSlippage === null ||
    hardMax === null ||
    waitHours === null ||
    perTrade === null ||
    daily === null
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      reserveAmount: reserve.value,
      autoTopUp: fields.autoTopUp === "on",
      maxSlippageBps: maxSlippage,
      hardMaxSlippageBps: hardMax,
      maxWaitMinutes: waitHours * 60,
      perTradeMaxUsd: perTrade,
      dailyMaxUsd: daily,
    },
  };
}

/** The stored rules as the form shows them (the inverse of parseRulesForm). */
export function rulesFormValues(row: RulesRow): Record<string, string> {
  return {
    reserveAmount: row.reserveAmount,
    autoTopUp: row.autoTopUp ? "on" : "",
    maxSlippagePct: formatDecimal(BigInt(row.maxSlippageBps), 2),
    hardMaxSlippagePct: formatDecimal(BigInt(row.hardMaxSlippageBps), 2),
    maxWaitHours: String(Math.round(row.maxWaitMinutes / 60)),
    perTradeMaxUsd: String(row.perTradeMaxUsd),
    dailyMaxUsd: String(row.dailyMaxUsd),
  };
}

export async function saveRules(db: Db, userId: string, input: RulesInput, now: Date): Promise<void> {
  await db.update(rules).set({ ...input, updatedAt: now }).where(eq(rules.userId, userId));
}
