import { describe, expect, it } from "vitest";
import { flapCells, FLAP_WIDTH } from "./flap";

describe("flapCells", () => {
  it("right-aligns text in a fixed number of cells", () => {
    const cells = flapCells("US$300.00");
    expect(cells).toHaveLength(FLAP_WIDTH);
    expect(cells.slice(0, 3)).toEqual([" ", " ", " "]);
    expect(cells.at(-1)).toBe("0");
    expect(flapCells("US$1,250.00").join("")).toBe(" US$1,250.00");
  });

  it("keeps the end of text that is too long", () => {
    expect(flapCells("X".repeat(15))).toHaveLength(FLAP_WIDTH);
  });
});
