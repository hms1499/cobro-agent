import { describe, expect, it } from "vitest";
import { safeNext, signInRedirect } from "./gate";

describe("signInRedirect", () => {
  it("sends signed-out visitors of /app to sign-in and remembers where they were", () => {
    expect(signInRedirect("/app/invoices/new", "?first=1", false)).toBe("/signin?next=%2Fapp%2Finvoices%2Fnew%3Ffirst%3D1");
    expect(signInRedirect("/app", "", false)).toBe("/signin?next=%2Fapp");
  });

  it("lets signed-in visitors and public pages through", () => {
    expect(signInRedirect("/app", "", true)).toBeNull();
    expect(signInRedirect("/pay/abc", "", false)).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps paths inside the app", () => {
    expect(safeNext("/app/invoices/new?first=1")).toBe("/app/invoices/new?first=1");
    expect(safeNext("/app")).toBe("/app");
  });

  it("refuses anything that could leave the app", () => {
    expect(safeNext("//evil.example")).toBe("/app");
    expect(safeNext("https://evil.example/app")).toBe("/app");
    expect(safeNext("/apple")).toBe("/app");
    expect(safeNext("/app\\@evil.example")).toBe("/app");
    expect(safeNext(null)).toBe("/app");
  });
});
