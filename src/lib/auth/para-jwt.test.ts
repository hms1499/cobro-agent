import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyParaJwt } from "./para-jwt";

let jwks: ReturnType<typeof createLocalJWKSet>;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const other = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256" }] });
});

function token(payload: JWTPayload, key = privateKey, expires: string | number | null = "10m") {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg: "ES256", kid: "k1" }).setSubject("user-1").setIssuedAt();
  if (expires !== null) jwt.setExpirationTime(expires);
  return jwt.sign(key);
}

const data = {
  userId: "user-1",
  email: "freelancer@example.com",
  wallets: [
    { id: "w-sol", type: "SOLANA", address: "EEp7DbBu5yvgf7Pr9W17cATPjCqUxY8K8R3dFbg53a3W" },
    { id: "w-evm", type: "EVM", address: "0x9dd3824f045c77bc369485e8f1dd6b452b6be617" },
  ],
};

describe("verifyParaJwt", () => {
  it("returns the user, email and checksummed EVM address", async () => {
    const session = await verifyParaJwt(await token({ data }), jwks);
    expect(session.paraUserId).toBe("user-1");
    expect(session.email).toBe("freelancer@example.com");
    expect(session.evmAddress).toBe("0x9DD3824f045c77bc369485e8f1DD6b452b6BE617");
    expect(session.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it("rejects an expired token", async () => {
    await expect(verifyParaJwt(await token({ data }, privateKey, Math.floor(Date.now() / 1000) - 60), jwks)).rejects.toThrow();
  });

  it("rejects a token signed by another key", async () => {
    await expect(verifyParaJwt(await token({ data }, otherPrivateKey), jwks)).rejects.toThrow();
  });

  it("rejects a token without an expiry", async () => {
    await expect(verifyParaJwt(await token({ data }, privateKey, null), jwks)).rejects.toThrow(/expiry/);
  });
});
