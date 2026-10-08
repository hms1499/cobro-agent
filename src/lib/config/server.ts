import type { Hex } from "viem";
import { z } from "zod";
import { FEE_TOKENS } from "@/lib/chain/tokens";
import { emptyToUndefined, parseOrThrow } from "./parse";

const serverEnvSchema = z.object({
  CELO_RPC_URL: z.preprocess(emptyToUndefined, z.url().default("https://forno.celo.org")),
  OPERATOR_PRIVATE_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key")
      .transform((key) => key as Hex)
      .optional(),
  ),
  OPERATOR_FEE_TOKEN: z.preprocess(emptyToUndefined, z.enum(FEE_TOKENS).default("USDT")),
  PARA_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  PARA_REST_BASE_URL: z.preprocess(emptyToUndefined, z.url().default("https://api.beta.getpara.com")),
  PARA_JWKS_URL: z.preprocess(
    emptyToUndefined,
    z.url().default("https://api.beta.getpara.com/.well-known/jwks.json"),
  ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  return parseOrThrow(serverEnvSchema, source, "server");
}

export function requireValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}
