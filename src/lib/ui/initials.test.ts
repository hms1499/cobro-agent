import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it("takes the first letter of the first two words, uppercased", () => {
    expect(initials("Lucía Fernández Studio")).toBe("LF");
    expect(initials("Pixel  Guild")).toBe("PG");
    expect(initials("acme")).toBe("A");
  });

  it("falls back to a question mark for a blank name", () => {
    expect(initials("  ")).toBe("?");
  });
});
