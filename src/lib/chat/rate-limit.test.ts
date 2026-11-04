import { describe, expect, it } from "vitest";
import { allowGroqCall } from "./rate-limit";

describe("allowGroqCall", () => {
  it("allows 20 calls an hour and then refuses", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 20; i++) expect(allowGroqCall("u-limit", t0 + i)).toBe(true);
    expect(allowGroqCall("u-limit", t0 + 21)).toBe(false);
    expect(allowGroqCall("u-other", t0 + 21)).toBe(true);
  });

  it("allows again once the hour has passed", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 20; i++) allowGroqCall("u-window", t0);
    expect(allowGroqCall("u-window", t0 + 1000)).toBe(false);
    expect(allowGroqCall("u-window", t0 + 60 * 60 * 1000 + 1)).toBe(true);
  });
});
