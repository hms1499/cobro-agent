import { describe, expect, it } from "vitest";
import { EXAMPLE_ARS_PER_USD, LANDING_EXAMPLES } from "./examples";

describe("LANDING_EXAMPLES", () => {
  it("each example adds up at the example rate", () => {
    expect(LANDING_EXAMPLES).toHaveLength(3);
    for (const example of LANDING_EXAMPLES) {
      const total = Number(example.kept.amount) / EXAMPLE_ARS_PER_USD + Number(example.saved.amount);
      expect(Math.abs(total - Number(example.paid.amount)) / Number(example.paid.amount)).toBeLessThan(0.01);
    }
  });
});
