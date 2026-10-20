import { describe, expect, it } from "vitest";
import { prefillEmail } from "./prefill";

describe("prefillEmail", () => {
  it("prefills only a plausible address", () => {
    expect(prefillEmail("  Ana@Estudio.com.ar ")).toBe("ana@estudio.com.ar");
    for (const raw of ["", null, undefined, "ana", "ana@local", "<script>@x.y", "a b@x.co", "a".repeat(250) + "@x.co"]) {
      expect(prefillEmail(raw)).toBeUndefined();
    }
  });
});
