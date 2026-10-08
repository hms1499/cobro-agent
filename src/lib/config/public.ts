import { getAddress } from "viem";
import { z } from "zod";
import { ATTRIBUTION_CODE_PATTERN } from "@/lib/chain/attribution";
import { emptyToUndefined, parseOrThrow } from "./parse";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .url({ protocol: /^https?$/ })
    .transform((url) => url.replace(/\/+$/, "")),
  NEXT_PUBLIC_ATTRIBUTION_CODE: z
    .string()
    .regex(ATTRIBUTION_CODE_PATTERN, "must be celo_ followed by 12 lowercase hex characters"),
  NEXT_PUBLIC_AGENT_WALLET: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address")
    .transform((address) => getAddress(address)),
  NEXT_PUBLIC_AGENT_ID: z.preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional()),
  NEXT_PUBLIC_PARA_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  NEXT_PUBLIC_PARA_ENVIRONMENT: z.preprocess(emptyToUndefined, z.enum(["BETA", "PROD"]).default("BETA")),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  return parseOrThrow(publicEnvSchema, source, "public");
}

/** Next.js inlines NEXT_PUBLIC_* only where each variable is written out literally. */
export function readPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ATTRIBUTION_CODE: process.env.NEXT_PUBLIC_ATTRIBUTION_CODE,
    NEXT_PUBLIC_AGENT_WALLET: process.env.NEXT_PUBLIC_AGENT_WALLET,
    NEXT_PUBLIC_AGENT_ID: process.env.NEXT_PUBLIC_AGENT_ID,
    NEXT_PUBLIC_PARA_API_KEY: process.env.NEXT_PUBLIC_PARA_API_KEY,
    NEXT_PUBLIC_PARA_ENVIRONMENT: process.env.NEXT_PUBLIC_PARA_ENVIRONMENT,
  });
}
