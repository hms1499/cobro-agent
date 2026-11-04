import { getDb } from "@/lib/db/client";
import type { RulesRow } from "@/lib/db/schema";
import { getReferenceRates } from "@/lib/fx/rates";
import { modeNeedsApproval } from "@/lib/treasury/approvals";
import { decide } from "@/lib/treasury/engine";
import { engineInput } from "@/lib/treasury/executor";
import { describeDecision } from "@/lib/treasury/explain";
import { readDisplayBalances } from "@/lib/treasury/live";
import type { AppUser } from "@/lib/users/queries";

/**
 * "If the agent ran now, it would…": the engine on live balances, as a sentence. It sends no RFQ and signs nothing.
 * Null when it cannot be worked out (no wallet yet, or a failed read); the rules still apply.
 */
export async function loadDecisionText(user: AppUser, row: RulesRow): Promise<string | null> {
  if (!user.treasuryAddress) return null;
  try {
    const [balances, rates] = await Promise.all([readDisplayBalances(user.treasuryAddress), getReferenceRates()]);
    const input = await engineInput(getDb(), { userId: user.id, rules: row }, balances, rates, new Date());
    const decision = decide(input);
    // A dollars freelancer's agent never asks (USD home spec §2.3), whatever mode is stored.
    const askFirst = decision.kind === "convert" && row.localCurrency !== "USD" && modeNeedsApproval(row.approvalMode, decision.reason);
    return describeDecision(decision, { local: row.localCurrency, rates }, { askFirst });
  } catch (error) {
    console.error("Rules preview failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
