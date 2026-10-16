import { describe, expect, it } from "vitest";
import { safeNext, signedInRedirect, signInRedirect } from "./gate";

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

describe("signedInRedirect", () => {
  it("sends a signed-in visitor of the landing page to the app", () => {
    expect(signedInRedirect("/", null)).toBe("/app");
  });

  it("sends a signed-in visitor of sign-in to where they were going, inside the app only", () => {
    expect(signedInRedirect("/signin", "/app/rules")).toBe("/app/rules");
    expect(signedInRedirect("/signin", null)).toBe("/app");
    expect(signedInRedirect("/signin", "https://evil.example/app")).toBe("/app");
  });

  it("leaves every other page alone", () => {
    expect(signedInRedirect("/pay/abc", null)).toBeNull();
    expect(signedInRedirect("/app", null)).toBeNull();
  });
});
