import { describe, expect, it } from "vitest";
import { walletModalOptions } from "./reauth";

describe("walletModalOptions", () => {
  it("opens Para's account view as is while its session lives", () => {
    expect(walletModalOptions("ana@estudio.com.ar", true)).toBeUndefined();
  });

  it("prefills the freelancer's email when Para asks them to sign in again", () => {
    expect(walletModalOptions(" Ana@Estudio.com.ar ", false)).toEqual({ defaultAuthIdentifier: "ana@estudio.com.ar" });
  });

  it("leaves Para's form empty without a usable email", () => {
    expect(walletModalOptions(null, false)).toBeUndefined();
    expect(walletModalOptions("ana", false)).toBeUndefined();
  });
});
