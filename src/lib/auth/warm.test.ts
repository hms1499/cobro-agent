import { describe, expect, it, vi } from "vitest";
import { warmSignIn } from "./warm";

describe("warmSignIn", () => {
  it("wakes the database and loads Para's signing keys together", async () => {
    const pingDb = vi.fn(async () => undefined);
    const reloadKeys = vi.fn(async () => undefined);
    expect(await warmSignIn({ pingDb, reloadKeys })).toEqual({ db: "ok", keys: "ok" });
    expect(pingDb).toHaveBeenCalledTimes(1);
    expect(reloadKeys).toHaveBeenCalledTimes(1);
  });

  it("reports a failed part without throwing, so sign-in itself is never blocked", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await warmSignIn({ pingDb: async () => Promise.reject(new Error("db asleep too long")), reloadKeys: async () => undefined });
    expect(result).toEqual({ db: "error", keys: "ok" });
    errors.mockRestore();
  });
});
