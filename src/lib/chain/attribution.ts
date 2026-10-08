import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";

export const ATTRIBUTION_CODE_PATTERN = /^celo_[0-9a-f]{12}$/;

export function attributionSuffix(code: string): Hex {
  if (!ATTRIBUTION_CODE_PATTERN.test(code)) {
    throw new Error(`Invalid attribution code "${code}": expected celo_ followed by 12 lowercase hex characters`);
  }
  return toDataSuffix(code) as Hex;
}

export function tagCalldata(data: Hex | undefined, code: string): Hex {
  const suffix = attributionSuffix(code);
  return data && data !== "0x" ? concat([data, suffix]) : suffix;
}

export function hasAttribution(data: Hex, code: string): boolean {
  return fromDataSuffix(data)?.codes.includes(code) ?? false;
}
