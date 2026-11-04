import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import type { ChatSwapError } from "@/lib/treasury/chat-swap";
import { outcomeView } from "./outcome";

const ERRORS: ChatSwapError[] = [
  "paused", "disabled", "dry_run", "not_ready", "unsupported_pair", "below_minimum", "insufficient", "daily_limit",
  "busy", "needs_gas", "no_quote", "price", "expired", "changed", "policy", "swap_failed", "unconfirmed",
];

describe("outcomeView", () => {
  it("gives every error a message and the next step of spec §5.2", () => {
    expect(outcomeView("no_quote").action).toBe("retry");
    expect(outcomeView("price").action).toBe("price_rules");
    expect(outcomeView("daily_limit").action).toBe("daily_rules");
    expect(outcomeView("needs_gas").action).toBe("add_funds");
    expect(outcomeView("swap_failed").action).toBe("retry");
    expect(outcomeView("insufficient").action).toBe("full_balance");
    expect(outcomeView("changed").action).toBe("retry");
    expect(outcomeView("busy").action).toBe("retry");
    expect(outcomeView("expired").action).toBe("retry");
  });

  it("has copy for every error, and never claims money moved on an unconfirmed swap", () => {
    for (const error of ERRORS) expect(en[outcomeView(error).message]).toBeTruthy();
    expect(en[outcomeView("unconfirmed").message]).toBe("We couldn't confirm this swap. Check History before trying again.");
    expect(en[outcomeView("busy").message]).toBe("Another transaction is finishing.");
  });
});
