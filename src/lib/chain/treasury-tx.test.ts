// src/lib/chain/treasury-tx.test.ts
import {
  custom,
  decodeFunctionData,
  erc20Abi,
  fromRlp,
  hexToBigInt,
  HttpRequestError,
  InternalRpcError,
  InvalidInputRpcError,
  keccak256,
  numberToHex,
  recoverAddress,
  RpcRequestError,
  TimeoutError,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey } from "viem/accounts";
import { parseTransaction, serializeTransaction } from "viem/celo";
import { describe, expect, it } from "vitest";
import { localKeyTreasurySigner, type TreasurySigner } from "@/lib/signer/treasury-signer";
import { attributionSuffix } from "./attribution";
import { createCeloPublicClient } from "./clients";
import { TOKENS } from "./tokens";
import {
  encodeTreasuryCall,
  GAS_FLOOR_ATOMIC,
  isNodeRejection,
  pickGasToken,
  signTreasuryTx,
  TEXTILE_REACTOR,
  TreasuryPolicyError,
} from "./treasury-tx";

const CODE = "celo_bc3965e128ba";
const PERSONAL: Address = "0x3333333333333333333333333333333333333333";
const STRANGER: Address = "0x000000000000000000000000000000000000dEaD";
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const POLICY = { allowedSpenders: [TEXTILE_REACTOR], personalWallet: PERSONAL, withdrawalAddresses: [] };
const SAVED: Address = "0x4444444444444444444444444444444444444444";

describe("pickGasToken", () => {
  const none = { USDT: 0n, USAT: 0n, USDC: 0n };
  it("prefers USD₮, then USA₮, then USDC, needing at least the floor", () => {
    expect(pickGasToken({ ...none, USDT: GAS_FLOOR_ATOMIC, USDC: 1_000_000n })).toBe("USDT");
    expect(pickGasToken({ ...none, USDT: GAS_FLOOR_ATOMIC - 1n, USAT: 30_000n })).toBe("USAT");
    expect(pickGasToken({ ...none, USDC: 50_000n })).toBe("USDC");
    expect(pickGasToken(none)).toBeNull();
  });

  it("leaves out a token the same transaction spends below the floor", () => {
    expect(pickGasToken({ ...none, USDT: 1_000_000n, USAT: 30_000n }, { asset: "USDT", amount: 990_000n })).toBe("USAT");
    expect(pickGasToken({ ...none, USDT: 1_000_000n }, { asset: "WARS", amount: 10n ** 30n })).toBe("USDT");
  });
});

describe("encodeTreasuryCall", () => {
  it("approves only an allowed spender", () => {
    const call = encodeTreasuryCall({ kind: "approve", asset: "WARS", spender: TEXTILE_REACTOR, amount: 5n }, POLICY);
    expect(call.to).toBe(TOKENS.WARS.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({ functionName: "approve", args: [TEXTILE_REACTOR, 5n] });
    expect(() => encodeTreasuryCall({ kind: "approve", asset: "WARS", spender: STRANGER, amount: 5n }, POLICY)).toThrow(TreasuryPolicyError);
  });

  it("swaps only on an allowed spender, with no value, on Celo", () => {
    const swap = { kind: "swap", to: TEXTILE_REACTOR, data: "0xabcdef", value: 0n, chainId: 42220 } as const;
    expect(encodeTreasuryCall(swap, POLICY)).toEqual({ to: TEXTILE_REACTOR, data: "0xabcdef" });
    expect(() => encodeTreasuryCall({ ...swap, to: STRANGER }, POLICY)).toThrow(TreasuryPolicyError);
    expect(() => encodeTreasuryCall({ ...swap, value: 1n }, POLICY)).toThrow(TreasuryPolicyError);
    expect(() => encodeTreasuryCall({ ...swap, chainId: 1 }, POLICY)).toThrow(TreasuryPolicyError);
  });

  it("sends withdrawals only to the freelancer's personal wallet", () => {
    const call = encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: PERSONAL, amount: 7n }, POLICY);
    expect(call.to).toBe(TOKENS.USDT.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({ functionName: "transfer", args: [PERSONAL, 7n] });
    expect(() => encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: STRANGER, amount: 7n }, POLICY)).toThrow(TreasuryPolicyError);
    expect(() =>
      encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: PERSONAL, amount: 7n }, { ...POLICY, personalWallet: null }),
    ).toThrow(TreasuryPolicyError);
    expect(() => encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: PERSONAL, amount: 0n }, POLICY)).toThrow(TreasuryPolicyError);
  });

  it("sends withdrawals to the personal wallet or a saved address", () => {
    const policy = { ...POLICY, withdrawalAddresses: [SAVED] };
    const call = encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: SAVED, amount: 7n }, policy);
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data }).args).toEqual([SAVED, 7n]);
    expect(() => encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: STRANGER, amount: 7n }, policy)).toThrow(TreasuryPolicyError);
    expect(() => encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: SAVED, amount: 7n }, POLICY)).toThrow(TreasuryPolicyError);
    expect(() => encodeTreasuryCall({ kind: "withdraw", asset: "USDT", to: SAVED, amount: 0n }, policy)).toThrow(TreasuryPolicyError);
  });
});

/** A node that answers just what signTreasuryTx asks, and records the calls. */
function fakeChain(over: { gasPrice?: Hex; tip?: Hex } = {}) {
  const calls: { method: string; params: unknown }[] = [];
  const transport = custom({
    async request({ method, params }) {
      calls.push({ method, params });
      switch (method) {
        case "eth_chainId":
          return "0xa4ec";
        case "eth_getTransactionCount":
          return "0x5";
        case "eth_estimateGas":
          return "0x186a0";
        case "eth_gasPrice":
          return over.gasPrice ?? "0x4a817c800";
        case "eth_maxPriorityFeePerGas":
          return over.tip ?? "0x3b9aca00";
        default:
          throw new Error(`unexpected RPC ${method}`);
      }
    },
  });
  return { client: createCeloPublicClient("http://unused", transport), calls };
}

describe("signTreasuryTx", () => {
  it("signs a tagged CIP-64 transaction that pays gas in the chosen stablecoin", async () => {
    const { client, calls } = fakeChain();
    const signer = localKeyTreasurySigner(generatePrivateKey());
    const call = encodeTreasuryCall({ kind: "approve", asset: "WARS", spender: TEXTILE_REACTOR, amount: 5n }, POLICY);

    const signed = await signTreasuryTx({ client, signer, attributionCode: CODE }, call, "USDT");

    expect(signed).toMatchObject({ nonce: 5, feeToken: "USDT" });
    expect(signed.hash).toBe(keccak256(signed.raw));
    const tx = parseTransaction(signed.raw) as unknown as {
      type: string;
      to: Address;
      data: Hex;
      nonce: number;
      gas: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      feeCurrency: Address;
    };
    expect(tx).toMatchObject({ type: "cip64", nonce: 5, gas: 120_000n, maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
    expect(tx.feeCurrency.toLowerCase()).toBe(TOKENS.USDT.feeCurrency!.toLowerCase());
    expect(tx.to.toLowerCase()).toBe(TOKENS.WARS.address.toLowerCase());
    expect(tx.data.toLowerCase()).toBe(`${call.data}${attributionSuffix(CODE).slice(2)}`.toLowerCase());

    // The signature inside the raw bytes recovers to the treasury wallet.
    const [yParity, r, s] = (fromRlp(`0x${signed.raw.slice(4)}`, "hex") as Hex[]).slice(-3);
    const unsigned = { ...(parseTransaction(signed.raw) as object), type: "cip64" } as Parameters<typeof serializeTransaction>[0];
    const recovered = await recoverAddress({
      hash: keccak256(serializeTransaction(unsigned)),
      signature: { r, s, yParity: yParity === "0x" ? 0 : 1 },
    });
    expect(recovered).toBe(signer.address);

    // Gas was estimated and priced in the fee currency.
    const estimate = calls.find((c) => c.method === "eth_estimateGas")!.params as [{ feeCurrency: string }];
    expect(estimate[0].feeCurrency.toLowerCase()).toBe(TOKENS.USDT.feeCurrency!.toLowerCase());
    expect(calls.find((c) => c.method === "eth_gasPrice")!.params).toEqual([TOKENS.USDT.feeCurrency]);
  });

  /** The signature parts and the signer they recover to, read back from the raw bytes. */
  async function signatureOf(raw: Hex) {
    const [yParity, r, s] = (fromRlp(`0x${raw.slice(4)}`, "hex") as Hex[]).slice(-3);
    const unsigned = { ...(parseTransaction(raw) as object), type: "cip64" } as Parameters<typeof serializeTransaction>[0];
    const signature = { r, s, yParity: yParity === "0x" ? 0 : 1 };
    return { s: hexToBigInt(s), recovered: await recoverAddress({ hash: keccak256(serializeTransaction(unsigned)), signature }) };
  }
  const call = () => encodeTreasuryCall({ kind: "approve", asset: "WARS", spender: TEXTILE_REACTOR, amount: 5n }, POLICY);

  it("normalises a high-s signature (EIP-2), which still recovers to the treasury wallet", async () => {
    const local = localKeyTreasurySigner(generatePrivateKey());
    // An MPC signer may return either of the two valid signatures; this one returns the high-s twin.
    const returned: bigint[] = [];
    const highS: TreasurySigner = {
      ...local,
      async signDigest(digest) {
        const sig = await local.signDigest(digest);
        const s = SECP256K1_N - hexToBigInt(sig.s);
        returned.push(s);
        return { r: sig.r, s: numberToHex(s, { size: 32 }), yParity: sig.yParity === 0 ? 1 : 0 };
      },
    };
    const signed = await signTreasuryTx({ client: fakeChain().client, signer: highS, attributionCode: CODE }, call(), "USDT");
    expect(returned[0] > SECP256K1_N / 2n).toBe(true);
    const { s, recovered } = await signatureOf(signed.raw);
    expect(s).toBe(SECP256K1_N - returned[0]);
    expect(recovered).toBe(local.address);
    expect(signed.hash).toBe(keccak256(signed.raw));
  });

  it("refuses a signature that does not recover to the treasury wallet", async () => {
    const other = localKeyTreasurySigner(generatePrivateKey());
    const wrong: TreasurySigner = { ...localKeyTreasurySigner(generatePrivateKey()), signDigest: (digest) => other.signDigest(digest) };
    await expect(signTreasuryTx({ client: fakeChain().client, signer: wrong, attributionCode: CODE }, call(), "USDT")).rejects.toThrow(
      /does not recover/,
    );
  });

  it("never offers a priority fee above the max fee", async () => {
    // gasPrice 1 gwei → max fee 2 gwei; the node suggests a 5 gwei tip.
    const { client } = fakeChain({ gasPrice: "0x3b9aca00", tip: "0x12a05f200" });
    const signer = localKeyTreasurySigner(generatePrivateKey());
    const signed = await signTreasuryTx({ client, signer, attributionCode: CODE }, call(), "USDT");
    const tx = parseTransaction(signed.raw) as unknown as { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
    expect(tx).toMatchObject({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n });
  });
});

describe("isNodeRejection", () => {
  const url = "http://unused";
  const body = { method: "eth_sendRawTransaction" };
  const rpc = (code: number, message: string) => new RpcRequestError({ body, error: { code, message }, url });

  it("is true only when the node answered and refused the bytes", () => {
    expect(isNodeRejection(new InvalidInputRpcError(rpc(-32000, "invalid sender")))).toBe(true);
    expect(isNodeRejection(rpc(-32000, "nonce too low"))).toBe(true);
    expect(isNodeRejection(rpc(-32602, "rlp: expected input list"))).toBe(true);
  });

  it("is false when the bytes may have reached the node", () => {
    expect(isNodeRejection(new HttpRequestError({ body, url, status: 502 }))).toBe(false);
    expect(isNodeRejection(new TimeoutError({ body, url }))).toBe(false);
    expect(isNodeRejection(new InternalRpcError(rpc(-32603, "internal error")))).toBe(false);
    expect(isNodeRejection(rpc(-32005, "rate limited"))).toBe(false);
    expect(isNodeRejection(new Error("fetch failed"))).toBe(false);
  });
});
