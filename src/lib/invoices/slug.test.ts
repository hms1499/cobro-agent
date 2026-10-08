import { describe, expect, it } from "vitest";
import { newSlug, SLUG_LENGTH } from "./slug";

describe("newSlug", () => {
  it("makes 10 base58 characters", () => {
    const slug = newSlug();
    expect(slug).toHaveLength(SLUG_LENGTH);
    expect(slug).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);
    expect(newSlug()).not.toBe(slug);
  });

  it("maps bytes onto the alphabet and skips bytes that would bias it", () => {
    const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i === 0 ? 255 : i - 1));
    expect(newSlug(bytes)).toBe("123456789A");
  });
});
