import { keccak256, recoverAddress, serializeSignature, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { rawSignatureToParts, toJsonSafe, withHexPrefix } from "./signature";

const r = `0x${"aa".repeat(32)}` as const;
const s = `0x${"bb".repeat(32)}` as const;

describe("withHexPrefix", () => {
  it("adds 0x only when missing", () => {
    expect(withHexPrefix("abcd")).toBe("0xabcd");
    expect(withHexPrefix("0xabcd")).toBe("0xabcd");
  });
});

describe("rawSignatureToParts", () => {
  it.each([
    ["1b", 0],
    ["1c", 1],
    ["00", 0],
    ["01", 1],
  ])("maps recovery byte %s to yParity %i, with or without 0x", (v, yParity) => {
    const unprefixed = `${r.slice(2)}${s.slice(2)}${v}`;
    expect(rawSignatureToParts(unprefixed)).toEqual({ r, s, yParity });
    expect(rawSignatureToParts(`0x${unprefixed}`)).toEqual({ r, s, yParity });
  });

  it("rejects other recovery bytes and wrong lengths", () => {
    expect(() => rawSignatureToParts(`${r.slice(2)}${s.slice(2)}05`)).toThrow(/recovery byte/);
    expect(() => rawSignatureToParts(`${r.slice(2)}${s.slice(2)}`)).toThrow(/65-byte/);
  });

  it("round-trips a real secp256k1 signature", async () => {
    const privateKey = generatePrivateKey();
    const hash = keccak256(toHex("cobro"));
    const signature = await sign({ hash, privateKey, to: "hex" });
    const parts = rawSignatureToParts(signature);
    const recovered = await recoverAddress({ hash, signature: serializeSignature(parts) });
    expect(recovered).toBe(privateKeyToAccount(privateKey).address);
  });
});

describe("toJsonSafe", () => {
  it("turns bigints into decimal strings, deeply", () => {
    expect(toJsonSafe({ a: 1n, b: [2n, { c: 3n }], d: "x" })).toEqual({ a: "1", b: ["2", { c: "3" }], d: "x" });
  });
});
