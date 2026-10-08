import { describe, expect, it } from "vitest";
import { addDays, formatDate, isoDate } from "./dates";
import { nextIssueAt } from "./schedule";

const d = (iso: string) => new Date(iso);

describe("dates", () => {
  it("adds days and prints UTC dates", () => {
    expect(isoDate(addDays(d("2026-10-30T22:00:00Z"), 7))).toBe("2026-11-06");
    expect(formatDate("2026-10-15")).toBe("Oct 15, 2026");
    expect(formatDate(d("2026-10-15T23:30:00Z"))).toBe("Oct 15, 2026");
  });
});

describe("nextIssueAt", () => {
  it("adds a week, keeping the time of day", () => {
    expect(nextIssueAt(d("2026-10-08T14:30:00Z"), "weekly", 8)).toEqual(d("2026-10-15T14:30:00Z"));
  });

  it("moves to the same day next month", () => {
    expect(nextIssueAt(d("2026-10-15T09:00:00Z"), "monthly", 15)).toEqual(d("2026-11-15T09:00:00Z"));
    expect(nextIssueAt(d("2026-12-15T09:00:00Z"), "monthly", 15)).toEqual(d("2027-01-15T09:00:00Z"));
  });

  it("clamps to short months and returns to the anchor day afterwards", () => {
    const feb = nextIssueAt(d("2027-01-31T09:00:00Z"), "monthly", 31);
    expect(feb).toEqual(d("2027-02-28T09:00:00Z"));
    expect(nextIssueAt(feb, "monthly", 31)).toEqual(d("2027-03-31T09:00:00Z"));
    expect(nextIssueAt(d("2028-01-31T09:00:00Z"), "monthly", 31)).toEqual(d("2028-02-29T09:00:00Z"));
  });
});
