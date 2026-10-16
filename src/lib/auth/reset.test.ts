import { describe, expect, it } from "vitest";
import { resetSessionResponse } from "./reset";
import { SESSION_COOKIE } from "./session";

describe("resetSessionResponse", () => {
  it("clears the session cookie and sends the visitor to sign-in", () => {
    const response = resetSessionResponse("https://cobro.test/api/session/reset");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://cobro.test/signin");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=;`);
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });
});
