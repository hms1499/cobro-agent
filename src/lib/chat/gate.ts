import type { Address } from "viem";
import type { Db } from "@/lib/db/client";
import { isPayAsset, type PayAsset } from "@/lib/money/currencies";
import { CARD_ID, type ChatSwapError, type ChatSwapInput } from "@/lib/treasury/chat-swap";
import { loadTreasuryContext } from "@/lib/treasury/repo";
import type { ChatReply } from "./reply";

export interface GateDeps {
  db: Db;
  flags: { enabled: boolean; dryRun: boolean };
}

/**
 * Spec §3.3, shared by the message and the card action: nothing is answered while the treasury is switched off or the
 * agent is paused. TREASURY_DRY_RUN is not checked here: chat still answers and shows the card, and only a tap refuses.
 * A user with no ready wallet reads as paused too: there is nothing to chat about yet.
 */
export async function chatGate(deps: GateDeps, userId: string): Promise<{ address: Address } | { reply: ChatReply }> {
  if (!deps.flags.enabled) return { reply: { kind: "paused" } };
  const ctx = await loadTreasuryContext(deps.db, userId);
  if (!ctx || !ctx.rules.enabled) return { reply: { kind: "paused" } };
  return { address: ctx.address };
}

export interface StartInput {
  from: PayAsset;
  to: PayAsset;
  amountAtomic: string;
  cardId: string;
  seenTurnsOff: boolean;
}

const ATOMIC = /^\d{1,78}$/;

/** The tap's input, checked field by field; anything off is refused as a changed card. */
export function parseStartInput(input: unknown): ChatSwapInput | null {
  const i = input as Partial<StartInput> | null;
  if (
    !i ||
    !isPayAsset(i.from) ||
    !isPayAsset(i.to) ||
    typeof i.amountAtomic !== "string" ||
    !ATOMIC.test(i.amountAtomic) ||
    typeof i.cardId !== "string" ||
    !CARD_ID.test(i.cardId) ||
    typeof i.seenTurnsOff !== "boolean"
  ) {
    return null;
  }
  return { from: i.from, to: i.to, amount: BigInt(i.amountAtomic), cardId: i.cardId, seenTurnsOff: i.seenTurnsOff };
}

/**
 * Spec §5: the tap's checks. Only the tap refuses in dry run (spec §3.3). `schedule` runs the swap after the
 * response; it is called only when every check passed.
 */
export async function startChatSwapRequest(
  deps: GateDeps,
  userId: string,
  input: unknown,
  schedule: (parsed: ChatSwapInput) => void,
): Promise<{ started: boolean; error?: ChatSwapError }> {
  const parsed = parseStartInput(input);
  if (!parsed) return { started: false, error: "changed" };
  if (!deps.flags.enabled) return { started: false, error: "disabled" };
  if (deps.flags.dryRun) return { started: false, error: "dry_run" };
  const ctx = await loadTreasuryContext(deps.db, userId);
  if (!ctx) return { started: false, error: "not_ready" };
  if (!ctx.rules.enabled) return { started: false, error: "paused" };
  schedule(parsed);
  return { started: true };
}
