import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import { wouldDoText } from "./would-do";

describe("wouldDoText", () => {
  it("opens the sentence with what the agent would do", () => {
    expect(wouldDoText("convert ARS 41,250 to dollars. Your spending money is low.")).toBe(
      "Your agent would convert ARS 41,250 to dollars. Your spending money is low.",
    );
  });
  it("says so plainly when the preview is unavailable", () => {
    expect(wouldDoText(null)).toBe(t("rules.previewUnavailable"));
  });
});
