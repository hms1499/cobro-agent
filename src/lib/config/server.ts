import type { Hex } from "viem";
import { z } from "zod";
import { FEE_TOKENS } from "@/lib/chain/tokens";
import { emptyToUndefined, parseOrThrow } from "./parse";

/** "true" / "false" only, so a typo never silently turns live trading on. */
const flag = (fallback: "true" | "false") =>
  z.preprocess(
    emptyToUndefined,
    z
      .enum(["true", "false"])
      .default(fallback)
      .transform((value) => value === "true"),
  );

export const PARA_ENDPOINTS: Record<"BETA" | "PROD", { restBaseUrl: string; jwksUrl: string }> = {
  BETA: {
    restBaseUrl: "https://api.beta.getpara.com",
    jwksUrl: "https://api.beta.getpara.com/.well-known/jwks.json",
  },
  PROD: {
    restBaseUrl: "https://api.getpara.com",
    jwksUrl: "https://api.getpara.com/.well-known/jwks.json",
  },
};

const serverEnvSchema = z
  .object({
    CELO_RPC_URL: z.preprocess(emptyToUndefined, z.url().default("https://forno.celo.org")),
    /** Second RPC for screens only (createCeloDisplayClient); money paths use CELO_RPC_URL alone. */
    CELO_RPC_FALLBACK_URL: z.preprocess(emptyToUndefined, z.url().default("https://rpc.ankr.com/celo")),
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
    /** Picks the Para endpoints and key prefixes; must match NEXT_PUBLIC_PARA_ENVIRONMENT on the client. */
    NEXT_PUBLIC_PARA_ENVIRONMENT: z.preprocess(emptyToUndefined, z.enum(["BETA", "PROD"]).default("BETA")),
    DATABASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, "must be at least 32 characters").optional()),
    X402_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    X402_FACILITATOR_URL: z.preprocess(emptyToUndefined, z.url().default("https://api.x402.celo.org")),
    CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, "must be at least 32 characters").optional()),
    TEXTILE_API_URL: z.preprocess(emptyToUndefined, z.url().default("https://api.textilecredit.com")),
    RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TREASURY_ENABLED: flag("false"),
    TREASURY_DRY_RUN: flag("true"),
  })
  .superRefine((env, ctx) => {
    const prefix = env.NEXT_PUBLIC_PARA_ENVIRONMENT === "PROD" ? "sk_prod_" : "sk_beta_";
    if (env.PARA_API_KEY !== undefined && !env.PARA_API_KEY.startsWith(prefix)) {
      ctx.addIssue({
        code: "custom",
        path: ["PARA_API_KEY"],
        message: `PARA_API_KEY must be a ${env.NEXT_PUBLIC_PARA_ENVIRONMENT} key (${prefix}…)`,
      });
    }
  })
  .transform((env) => ({
    ...env,
    PARA_REST_BASE_URL: PARA_ENDPOINTS[env.NEXT_PUBLIC_PARA_ENVIRONMENT].restBaseUrl,
    PARA_JWKS_URL: PARA_ENDPOINTS[env.NEXT_PUBLIC_PARA_ENVIRONMENT].jwksUrl,
  }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  return parseOrThrow(serverEnvSchema, source, "server");
}

export function requireValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}
