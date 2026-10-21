import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./public";
import { parseServerEnv, requireValue } from "./server";

const validPublic = {
  NEXT_PUBLIC_APP_URL: "https://cobro-agent.vercel.app/",
  NEXT_PUBLIC_ATTRIBUTION_CODE: "celo_bc3965e128ba",
  NEXT_PUBLIC_AGENT_WALLET: "0x64ad61211c1b0b7f20b3e04b49661f30f152ae78",
  NEXT_PUBLIC_AGENT_ID: "",
};

describe("parsePublicEnv", () => {
  it("parses valid values, trims the URL's trailing slash and checksums the wallet", () => {
    const env = parsePublicEnv(validPublic);
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://cobro-agent.vercel.app");
    expect(env.NEXT_PUBLIC_AGENT_WALLET).toBe("0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78");
    expect(env.NEXT_PUBLIC_AGENT_ID).toBeUndefined();
  });

  it("reads the agent id as a number once it is set", () => {
    expect(parsePublicEnv({ ...validPublic, NEXT_PUBLIC_AGENT_ID: "9752" }).NEXT_PUBLIC_AGENT_ID).toBe(9752);
  });

  it("names the variable when the attribution code is mistyped", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_ATTRIBUTION_CODE: "celo_bc3965e128b" })).toThrow(
      /NEXT_PUBLIC_ATTRIBUTION_CODE/,
    );
  });

  it("names the variable when the app URL is missing", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_APP_URL: undefined })).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("rejects a malformed agent wallet", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_AGENT_WALLET: "0x1234" })).toThrow(
      /NEXT_PUBLIC_AGENT_WALLET/,
    );
  });
});

describe("Para environment", () => {
  it("derives PROD endpoints from the Para environment", () => {
    const env = parseServerEnv({ NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD" });
    expect(env.PARA_REST_BASE_URL).toBe("https://api.getpara.com");
    expect(env.PARA_JWKS_URL).toBe("https://api.getpara.com/.well-known/jwks.json");
  });
  it("ignores a stale endpoint variable", () => {
    const env = parseServerEnv({
      NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD",
      PARA_REST_BASE_URL: "https://api.beta.getpara.com",
    });
    expect(env.PARA_REST_BASE_URL).toBe("https://api.getpara.com");
  });
  it("refuses a secret key from the other Para environment", () => {
    expect(() => parseServerEnv({ NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD", PARA_API_KEY: "sk_beta_abc" })).toThrow(
      /PARA_API_KEY.*PROD/,
    );
    expect(() => parseServerEnv({ PARA_API_KEY: "sk_prod_abc" })).toThrow(/PARA_API_KEY.*BETA/);
    expect(parseServerEnv({ NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD", PARA_API_KEY: "sk_prod_abc" }).PARA_API_KEY).toBe(
      "sk_prod_abc",
    );
  });
  it("never echoes the rejected key", () => {
    expect(() => parseServerEnv({ PARA_API_KEY: "sk_prod_secretvalue" })).toThrow(/^(?!.*secretvalue)/);
  });
  it("refuses a public key from the other Para environment", () => {
    expect(() =>
      parsePublicEnv({ ...validPublic, NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD", NEXT_PUBLIC_PARA_API_KEY: "beta_abc" }),
    ).toThrow(/NEXT_PUBLIC_PARA_API_KEY.*PROD/);
    expect(
      parsePublicEnv({ ...validPublic, NEXT_PUBLIC_PARA_ENVIRONMENT: "PROD", NEXT_PUBLIC_PARA_API_KEY: "prod_abc" })
        .NEXT_PUBLIC_PARA_API_KEY,
    ).toBe("prod_abc");
  });
});

describe("parseServerEnv", () => {
  it("applies defaults when nothing is set", () => {
    const env = parseServerEnv({});
    expect(env.CELO_RPC_URL).toBe("https://forno.celo.org");
    expect(env.CELO_RPC_FALLBACK_URL).toBe("https://rpc.ankr.com/celo");
    expect(env.OPERATOR_FEE_TOKEN).toBe("USDT");
    expect(env.PARA_REST_BASE_URL).toBe("https://api.beta.getpara.com");
    expect(env.PARA_JWKS_URL).toBe("https://api.beta.getpara.com/.well-known/jwks.json");
    expect(env.OPERATOR_PRIVATE_KEY).toBeUndefined();
  });

  it("treats empty strings from .env files as unset", () => {
    const env = parseServerEnv({ OPERATOR_PRIVATE_KEY: "", PARA_API_KEY: "", OPERATOR_FEE_TOKEN: "" });
    expect(env.OPERATOR_PRIVATE_KEY).toBeUndefined();
    expect(env.PARA_API_KEY).toBeUndefined();
    expect(env.OPERATOR_FEE_TOKEN).toBe("USDT");
  });

  it("rejects a malformed private key without echoing it", () => {
    let message = "";
    try {
      parseServerEnv({ OPERATOR_PRIVATE_KEY: "0xdeadbeef" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/OPERATOR_PRIVATE_KEY/);
    expect(message).not.toMatch(/deadbeef/);
  });

  it("rejects an unknown fee token", () => {
    expect(() => parseServerEnv({ OPERATOR_FEE_TOKEN: "DAI" })).toThrow(/OPERATOR_FEE_TOKEN/);
  });
});

describe("requireValue", () => {
  it("returns the value or throws naming the variable", () => {
    expect(requireValue("x", "A")).toBe("x");
    expect(() => requireValue(undefined, "PARA_API_KEY")).toThrow("PARA_API_KEY is not set");
  });
});

describe("Plan 2 server variables", () => {
  it("defaults the facilitator and Textile URLs", () => {
    const env = parseServerEnv({});
    expect(env.X402_FACILITATOR_URL).toBe("https://api.x402.celo.org");
    expect(env.TEXTILE_API_URL).toBe("https://api.textilecredit.com");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it("accepts a Neon connection string", () => {
    const url = "postgresql://cobro:pw@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
    expect(parseServerEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("rejects a short session secret without echoing it", () => {
    let message = "";
    try {
      parseServerEnv({ SESSION_SECRET: "short-secret-value" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/SESSION_SECRET/);
    expect(message).not.toContain("short-secret-value");
  });

  it("rejects a short cron secret", () => {
    expect(() => parseServerEnv({ CRON_SECRET: "abc" })).toThrow(/CRON_SECRET/);
  });
});

describe("Para public variables", () => {
  it("defaults the Para environment to BETA and leaves the key unset", () => {
    const env = parsePublicEnv(validPublic);
    expect(env.NEXT_PUBLIC_PARA_ENVIRONMENT).toBe("BETA");
    expect(env.NEXT_PUBLIC_PARA_API_KEY).toBeUndefined();
  });

  it("rejects an unknown Para environment", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_PARA_ENVIRONMENT: "STAGING" })).toThrow(
      /NEXT_PUBLIC_PARA_ENVIRONMENT/,
    );
  });
});

describe("treasury switches", () => {
  it("defaults to off and dry run", () => {
    const env = parseServerEnv({});
    expect(env.TREASURY_ENABLED).toBe(false);
    expect(env.TREASURY_DRY_RUN).toBe(true);
  });

  it("reads true and false", () => {
    const env = parseServerEnv({ TREASURY_ENABLED: "true", TREASURY_DRY_RUN: "false" });
    expect(env.TREASURY_ENABLED).toBe(true);
    expect(env.TREASURY_DRY_RUN).toBe(false);
  });

  it("names the variable on anything else", () => {
    expect(() => parseServerEnv({ TREASURY_DRY_RUN: "yes" })).toThrow(/TREASURY_DRY_RUN/);
  });
});
