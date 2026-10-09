import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./auth";

const SECRET = "s".repeat(40);

describe("isAuthorizedCron", () => {
  it("accepts exactly the bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong, missing or differently formatted secret", () => {
    expect(isAuthorizedCron(`Bearer ${"t".repeat(40)}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
  });

  it("rejects everything while no secret is configured", () => {
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
  });
});
