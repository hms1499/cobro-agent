// src/lib/chat/parse.ts
import type { PayAsset } from "@/lib/money/currencies";

export type ChatCommand =
  | { kind: "swap"; from: PayAsset | null; to: PayAsset; amount: string | null }
  | { kind: "save_in_dollars" }
  | { kind: "balance" }
  | { kind: "unknown" };

const ALIASES: Record<string, PayAsset> = {
  usdt: "USDT",
  "usd₮": "USDT",
  dollar: "USDT",
  dollars: "USDT",
  usat: "USAT",
  "usa₮": "USAT",
  wars: "WARS",
  wbrl: "WBRL",
};

const TOKEN = "(usdt|usd₮|dollars?|usat|usa₮|wars|wbrl)";
const AMOUNT = "(\\d+(?:[.,]\\d+)?)";
const SWAP = new RegExp(`^swap (?:${AMOUNT} )?(?:${TOKEN} )?(?:to|into|sang) ${TOKEN}$`);
const SAVE = /^save (?:everything |all |it |my money )?in dollars$/;
const BALANCE = /^(?:balances?|my balances?|what do i have|what have i got)$/;

/**
 * Reads one chat message into a command with anchored patterns. Anything that does not match
 * exactly, including every address and every unknown token, is "unknown". The amount stays the
 * raw text for parseFiatInput to judge.
 */
export function parseCommand(text: string): ChatCommand {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?!.]+$/, "");
  if (SAVE.test(t)) return { kind: "save_in_dollars" };
  if (BALANCE.test(t)) return { kind: "balance" };
  const m = SWAP.exec(t);
  if (!m) return { kind: "unknown" };
  const [, amount, from, to] = m;
  return {
    kind: "swap",
    from: from ? ALIASES[from]! : null,
    to: ALIASES[to!]!,
    amount: amount ?? null,
  };
}
