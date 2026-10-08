import type { TokenSymbol } from "@/lib/chain/tokens";

export const FIAT_CURRENCIES = ["USD", "ARS", "BRL"] as const;
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

export const LOCAL_CURRENCIES = ["ARS", "BRL"] as const;
export type LocalCurrency = (typeof LOCAL_CURRENCIES)[number];

/** Tokens a client can pay an invoice with (USDC is out of scope, spec §5). */
export const PAY_ASSETS = ["USAT", "USDT", "WARS", "WBRL"] as const satisfies readonly TokenSymbol[];
export type PayAsset = (typeof PAY_ASSETS)[number];

/** The fiat currency each pay asset tracks one-to-one. */
export const ASSET_DENOMINATION: Record<PayAsset, FiatCurrency> = {
  USAT: "USD",
  USDT: "USD",
  WARS: "ARS",
  WBRL: "BRL",
};

export function isPayAsset(value: unknown): value is PayAsset {
  return typeof value === "string" && (PAY_ASSETS as readonly string[]).includes(value);
}

export function isFiatCurrency(value: unknown): value is FiatCurrency {
  return typeof value === "string" && (FIAT_CURRENCIES as readonly string[]).includes(value);
}

export function isLocalCurrency(value: unknown): value is LocalCurrency {
  return typeof value === "string" && (LOCAL_CURRENCIES as readonly string[]).includes(value);
}
