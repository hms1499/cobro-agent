import type { Address } from "viem";

export type TokenSymbol = "USDT" | "USAT" | "USDC" | "WARS" | "WBRL";
export type TransferMethod = "eip3009" | "permit2";

export interface TokenInfo {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
  transferMethod: TransferMethod;
  /** EIP-712 domain, read on-chain (name(), eip712Domain()) on 2026-10-08. */
  eip712: { name: string; version: string };
  /** CIP-64 `feeCurrency` value. 6-decimal tokens go through an adapter. */
  feeCurrency?: Address;
}

export const TOKENS: Record<TokenSymbol, TokenInfo> = {
  USDT: {
    symbol: "USDT",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    decimals: 6,
    transferMethod: "eip3009",
    eip712: { name: "Tether USD", version: "1" },
    feeCurrency: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72",
  },
  USAT: {
    symbol: "USAT",
    address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
    decimals: 6,
    transferMethod: "eip3009",
    eip712: { name: "Tether America USD", version: "1" },
    feeCurrency: "0x0357EE22278c922e1D36cFe6b899269b161880C4",
  },
  USDC: {
    symbol: "USDC",
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
    transferMethod: "eip3009",
    eip712: { name: "USDC", version: "2" },
    feeCurrency: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
  },
  WARS: {
    symbol: "WARS",
    address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D",
    decimals: 18,
    transferMethod: "permit2",
    eip712: { name: "Peso Argentino", version: "1" },
  },
  WBRL: {
    symbol: "WBRL",
    address: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0",
    decimals: 18,
    transferMethod: "permit2",
    eip712: { name: "Real Brasileño", version: "1" },
  },
};

export const FEE_TOKENS = ["CELO", "USDT", "USDC", "USAT"] as const;
export type FeeToken = (typeof FEE_TOKENS)[number];

export function feeCurrencyFor(token: FeeToken): Address | undefined {
  return token === "CELO" ? undefined : TOKENS[token].feeCurrency;
}
