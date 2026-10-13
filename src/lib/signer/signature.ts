import { hexToBigInt, numberToHex, type Hex } from "viem";

/** The order of secp256k1's group. */
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export function withHexPrefix(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

/** Para returns 65-byte r||s||v signatures without 0x; v may be 0/1 or 27/28. */
export function rawSignatureToParts(signature: string): { r: Hex; s: Hex; yParity: 0 | 1 } {
  const hex = withHexPrefix(signature);
  if (hex.length !== 132) {
    throw new Error(`Expected a 65-byte signature, got ${(hex.length - 2) / 2} bytes`);
  }
  const v = Number.parseInt(hex.slice(130, 132), 16);
  let yParity: 0 | 1;
  if (v === 0 || v === 27) yParity = 0;
  else if (v === 1 || v === 28) yParity = 1;
  else throw new Error(`Unexpected recovery byte ${v}`);
  return { r: `0x${hex.slice(2, 66)}` as Hex, s: `0x${hex.slice(66, 130)}` as Hex, yParity };
}

/**
 * EIP-2: nodes reject a signature whose s is in the upper half of the curve order. A raw-digest MPC
 * signer may return either of the two valid signatures, so the high one becomes its low twin
 * (s' = n − s, with the recovery bit flipped); both recover to the same address.
 */
export function toLowS<T extends { s: Hex; yParity: 0 | 1 }>(signature: T): T {
  const s = hexToBigInt(signature.s);
  if (s <= SECP256K1_N / 2n) return signature;
  return { ...signature, s: numberToHex(SECP256K1_N - s, { size: 32 }), yParity: signature.yParity === 0 ? 1 : 0 };
}

/** JSON cannot carry bigint; Para accepts uint values as decimal strings. */
export function toJsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]));
  }
  return value;
}
