import { describe, expect, it } from "vitest";
import { t } from "./index";

describe("t", () => {
  it("returns the English text for a key", () => {
    expect(t("app.name")).toBe("Cobro");
  });

  it("fills {placeholders} from vars", () => {
    expect(t("admin.registeredAs", { agentId: 9752 })).toBe("Registered as agent #9752");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(t("admin.registeredAs")).toBe("Registered as agent #{agentId}");
  });
});
