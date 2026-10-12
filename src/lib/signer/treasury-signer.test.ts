// src/lib/signer/treasury-signer.test.ts
import { keccak256, recoverAddress, toHex, verifyTypedData, type Address, type Hex, type TypedDataDefinition } from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { takerControlTypedData } from "@/lib/fx/rfq";
import { TreasuryPolicyError } from "@/lib/chain/treasury-tx";
import { localKeyTreasurySigner, paraTreasurySigner } from "./treasury-signer";

const DIGEST = keccak256(toHex("cobro"));
const TAKER: Address = "0x1111111111111111111111111111111111111111";
const NONCE = `0x${"ab".repeat(32)}` as Hex;

describe("paraTreasurySigner", () => {
  it("signs a digest through sign-raw and returns r, s and yParity", async () => {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const { r, s, yParity } = await sign({ hash: DIGEST, privateKey: key });
    // Para answers r||s||v without 0x, with v as 27 or 28.
    const raw = `${r.slice(2)}${s.slice(2)}${((yParity ?? 0) + 27).toString(16)}` as Hex;
    const client = { signRaw: vi.fn(async () => raw), signTypedData: vi.fn() };
    const signer = paraTreasurySigner(client, { id: "w1", address: account.address });
    const parts = await signer.signDigest(DIGEST);
    expect(client.signRaw).toHaveBeenCalledWith("w1", DIGEST);
    expect(await recoverAddress({ hash: DIGEST, signature: parts })).toBe(account.address);
  });

  it("sends typed data JSON-safe and without the EIP712Domain type", async () => {
    const client = { signRaw: vi.fn(), signTypedData: vi.fn(async () => "0x1234" as Hex) };
    const signer = paraTreasurySigner(client, { id: "w1", address: TAKER });
    const data = takerControlTypedData(TAKER, NONCE, 1_760_000_000_000);
    const withDomainType = { ...data, types: { ...data.types, EIP712Domain: [{ name: "name", type: "string" }] } };
    expect(await signer.signTypedData(withDomainType as unknown as TypedDataDefinition)).toBe("0x1234");
    expect(client.signTypedData).toHaveBeenCalledWith("w1", {
      domain: { name: "Textile Taker Control", version: "1", chainId: 42220 },
      types: { TakerControl: data.types.TakerControl },
      primaryType: "TakerControl",
      message: { taker: TAKER, chainId: "42220", nonce: NONCE, issuedAt: "1760000000000" },
    });
  });
});

describe("typed data policy", () => {
  const transferWithAuthorization = {
    domain: { name: "USDT", version: "1", chainId: 42220, verifyingContract: TAKER },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { from: TAKER, to: TAKER, value: 1n },
  } as unknown as TypedDataDefinition;
  const wrongChain = takerControlTypedData(TAKER, NONCE, 1_760_000_000_000);
  const onChain1 = { ...wrongChain, domain: { ...wrongChain.domain, chainId: 1 } } as unknown as TypedDataDefinition;

  it("refuses anything but TakerControl before reaching Para", async () => {
    const client = { signRaw: vi.fn(), signTypedData: vi.fn(async () => "0x12" as Hex) };
    const signer = paraTreasurySigner(client, { id: "w1", address: TAKER });
    await expect(signer.signTypedData(transferWithAuthorization)).rejects.toThrow(TreasuryPolicyError);
    await expect(signer.signTypedData(onChain1)).rejects.toThrow(TreasuryPolicyError);
    expect(client.signTypedData).not.toHaveBeenCalled();
  });

  it("refuses the same payloads on a local key", async () => {
    const signer = localKeyTreasurySigner(generatePrivateKey());
    await expect(signer.signTypedData(transferWithAuthorization)).rejects.toThrow(TreasuryPolicyError);
    await expect(signer.signTypedData(onChain1)).rejects.toThrow(TreasuryPolicyError);
  });
});

describe("localKeyTreasurySigner", () => {
  it("signs digests and typed data with a local key", async () => {
    const signer = localKeyTreasurySigner(generatePrivateKey());
    expect(await recoverAddress({ hash: DIGEST, signature: await signer.signDigest(DIGEST) })).toBe(signer.address);
    const data = takerControlTypedData(signer.address, NONCE, 1_760_000_000_000);
    const signature = await signer.signTypedData(data);
    expect(await verifyTypedData({ ...data, address: signer.address, signature })).toBe(true);
  });
});
