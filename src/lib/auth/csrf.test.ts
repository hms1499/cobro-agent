import { describe, expect, it } from "vitest";
import { isTrustedJsonPost } from "./csrf";

const post = (headers: Record<string, string>) =>
  new Request("https://cobro-agent.vercel.app/api/session", { method: "POST", headers, body: "{}" });

describe("isTrustedJsonPost", () => {
  it("accepts a same-origin JSON post, with or without Sec-Fetch-Site", () => {
    expect(isTrustedJsonPost(post({ "content-type": "application/json" }))).toBe(true);
    expect(isTrustedJsonPost(post({ "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("refuses bodies a cross-site form can send without a CORS preflight", () => {
    expect(isTrustedJsonPost(post({ "content-type": "text/plain" }))).toBe(false);
    expect(isTrustedJsonPost(post({ "content-type": "application/x-www-form-urlencoded" }))).toBe(false);
    expect(isTrustedJsonPost(post({ "content-type": "multipart/form-data; boundary=x" }))).toBe(false);
    expect(isTrustedJsonPost(post({}))).toBe(false);
  });

  it("refuses requests the browser marks as coming from another site", () => {
    expect(isTrustedJsonPost(post({ "content-type": "application/json", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isTrustedJsonPost(post({ "content-type": "application/json", "sec-fetch-site": "same-site" }))).toBe(false);
  });
});
