import { custom, parseGwei, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseTransaction } from "viem/celo";
import { describe, expect, it } from "vitest";
import { attributionSuffix } from "./attribution";
import { createOperatorClient, operatorSendParams } from "./clients";

const CODE = "celo_bc3965e128ba";

/** Fake RPC that only knows the chain id and captures the raw transaction. */
function captureTransport() {
  const captured: { raw?: Hex } = {};
  const transport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return "0xa4ec";
      if (method === "eth_sendRawTransaction") {
        captured.raw = (params as [Hex])[0];
        return `0x${"11".repeat(32)}`;
      }
      throw new Error(`unexpected RPC ${method}`);
    },
  });
  return { transport, captured };
}

const fixedGas = { gas: 60_000n, maxFeePerGas: parseGwei("30"), maxPriorityFeePerGas: parseGwei("1"), nonce: 0 };

describe("createOperatorClient", () => {
  it("tags a plain self-transfer and pays gas through the USDT adapter (CIP-64)", async () => {
    const { transport, captured } = captureTransport();
    const privateKey = generatePrivateKey();
    const client = createOperatorClient({ privateKey, attributionCode: CODE, rpcUrl: "http://unused", transport });
    const self = privateKeyToAccount(privateKey).address;

    await client.sendTransaction({ to: self, value: 0n, ...operatorSendParams("USDT"), ...fixedGas });

    const tx = parseTransaction(captured.raw!);
    expect(tx.type).toBe("cip64");
    // viem/celo parses CIP-64 but types the result as the generic TransactionSerializable
    const { feeCurrency } = tx as { feeCurrency?: Hex };
    expect(feeCurrency?.toLowerCase()).toBe("0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72");
    expect(tx.data).toBe(attributionSuffix(CODE));
  });

  it("appends the tag after existing calldata", async () => {
    const { transport, captured } = captureTransport();
    const client = createOperatorClient({ privateKey: generatePrivateKey(), attributionCode: CODE, rpcUrl: "http://unused", transport });

    await client.sendTransaction({
      to: "0x000000000000000000000000000000000000dEaD",
      data: "0xa9059cbb",
      ...operatorSendParams("USDC"),
      ...fixedGas,
    });

    const tx = parseTransaction(captured.raw!);
    expect(tx.data?.startsWith("0xa9059cbb")).toBe(true);
    expect(tx.data?.endsWith(attributionSuffix(CODE).slice(2))).toBe(true);
  });

  it("sends a normal EIP-1559 transaction when gas is paid in CELO", async () => {
    const { transport, captured } = captureTransport();
    const client = createOperatorClient({ privateKey: generatePrivateKey(), attributionCode: CODE, rpcUrl: "http://unused", transport });

    await client.sendTransaction({
      to: "0x000000000000000000000000000000000000dEaD",
      value: 0n,
      ...operatorSendParams("CELO"),
      ...fixedGas,
    });

    const tx = parseTransaction(captured.raw!);
    expect(tx.type).toBe("eip1559");
    expect(tx.data).toBe(attributionSuffix(CODE));
  });

  it("refuses an invalid attribution code before sending anything", () => {
    expect(() =>
      createOperatorClient({ privateKey: generatePrivateKey(), attributionCode: "celo_x", rpcUrl: "http://unused" }),
    ).toThrow(/attribution code/i);
  });
});
