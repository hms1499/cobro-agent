// src/lib/invoices/dates.test.ts
import { describe, expect, it } from "vitest";
import { formatDateTime } from "./dates";

describe("formatDateTime", () => {
  it("prints a timestamp in UTC and says so", () => {
    expect(formatDateTime(new Date("2026-10-15T15:04:00Z"))).toBe("Oct 15, 2026, 3:04 PM UTC");
  });
});
