import { describe, expect, it } from "vitest";
import { en } from "./en";
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

describe("copy", () => {
  it("keeps jargon and stale facts out of the app", () => {
    for (const value of Object.values(en)) {
      expect(value).not.toMatch(/every 10 minutes|requests filled|Behind holding|Held by your agent/);
    }
  });

  it("states the real check interval", () => {
    expect(t("agent.help.active", { minutes: 20 })).toContain("20 minutes");
  });
});
