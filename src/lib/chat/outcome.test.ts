import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import type { ChatSwapError } from "@/lib/treasury/chat-swap";
import { formatMoney } from "@/lib/money/format";
import { outcomeText, outcomeView } from "./outcome";

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

  it("names the button a changed swap is retried with, and promises no card that is not there yet", () => {
    expect(outcomeText("changed")).toContain(en["common.retry"]);
    expect(outcomeText("changed")).not.toContain("refreshed card");
  });

  it("states the minimum through formatMoney, with no amount in the copy itself", () => {
    expect(en["chat.error.below_minimum"]).not.toContain("US$");
    expect(outcomeText("below_minimum")).toBe(`The smallest swap is ${formatMoney("1.00", "USD")}.`);
  });

  it("leaves no placeholder in any sentence", () => {
    for (const error of ERRORS) expect(outcomeText(error)).not.toContain("{");
  });
});
