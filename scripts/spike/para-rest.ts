import { verifyTx } from "@celo/attribution-tags";
import { randomBytes, randomUUID } from "node:crypto";
import {
  encodeFunctionData,
  erc20Abi,
  isAddressEqual,
  keccak256,
  recoverAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  serializeSignature,
  toHex,
  type Address,
} from "viem";
import { serializeTransaction } from "viem/celo";
import { attributionSuffix } from "@/lib/chain/attribution";
import { createCeloPublicClient } from "@/lib/chain/clients";
import { TOKENS } from "@/lib/chain/tokens";
import { readPublicEnv } from "@/lib/config/public";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { ParaRestClient, ParaRestError, type ParaTypedData } from "@/lib/signer/para-rest";
import { rawSignatureToParts, toJsonSafe } from "@/lib/signer/signature";

// Checks 1–3 and 5 run by default. Check 4 runs with SPIKE_GUARDRAIL=1 after a Guardrail exists.
// Reuse a wallet with SPIKE_WALLET_ID=<id>.
async function main() {
  const server = parseServerEnv();
  const code = readPublicEnv().NEXT_PUBLIC_ATTRIBUTION_CODE;
  const para = new ParaRestClient({
    apiKey: requireValue(server.PARA_API_KEY, "PARA_API_KEY"),
    baseUrl: server.PARA_REST_BASE_URL,
  });
  const publicClient = createCeloPublicClient(server.CELO_RPC_URL);
  const results: { check: string; pass: boolean; detail: string }[] = [];
  const record = (check: string, pass: boolean, detail: string) => {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check}  ${detail}`);
  };

  // 1. App-owned wallet keyed by CUSTOM_ID
  const walletId = process.env.SPIKE_WALLET_ID ?? (await para.createWallet(`cobro-spike-${Date.now()}`)).id;
  const wallet = await para.waitUntilReady(walletId);
  const address = wallet.address as Address;
  record("create-wallet", true, `${wallet.id} ${address}`);

  // 2. EIP-712 Textile TakerControl
  const typedData = {
    domain: { name: "Textile Taker Control", version: "1", chainId: 42220 },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker: address, chainId: 42220n, nonce: toHex(randomBytes(32)), issuedAt: BigInt(Date.now()) },
  } as const;
  const typedSignature = await para.signTypedData(wallet.id, toJsonSafe(typedData) as ParaTypedData);
  const typedSigner = await recoverTypedDataAddress({ ...typedData, signature: typedSignature });
  record("sign-typed-data", isAddressEqual(typedSigner, address), `recovered ${typedSigner}`);

  // 3. EIP-1559 transaction with our tag, broadcast by us
  const balance = await publicClient.getBalance({ address });
  if (balance === 0n) {
    console.log(`\nFund ${address} with 0.02 CELO, then re-run with SPIKE_WALLET_ID=${wallet.id}`);
    process.exit(2);
  }
  const nonce = await publicClient.getTransactionCount({ address });
  const fees = await publicClient.estimateFeesPerGas();
  const tagData = attributionSuffix(code);
  const gas = await publicClient.estimateGas({ account: address, to: address, data: tagData, value: 0n });
  const signedTx = await para.signTransaction(
    wallet.id,
    {
      to: address,
      chainId: 42220,
      type: 2,
      value: "0",
      data: tagData,
      nonce,
      gasLimit: gas.toString(),
      maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    },
    randomUUID(),
  );
  const txSigner = await recoverTransactionAddress({ serializedTransaction: signedTx as `0x02${string}` });
  record("sign-transaction", isAddressEqual(txSigner, address), `recovered ${txSigner}`);
  const hash = await publicClient.sendRawTransaction({ serializedTransaction: signedTx });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const decoded = await verifyTx({ client: publicClient, hash });
  record(
    "broadcast-tagged",
    receipt.status === "success" && (decoded?.codes.includes(code) ?? false),
    `https://celoscan.io/tx/${hash}`,
  );

  // 4. Guardrail (run after creating it in the Para Developer Portal)
  if (process.env.SPIKE_GUARDRAIL === "1") {
    const outsideCall = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: ["0x000000000000000000000000000000000000dEaD", 1n],
    });
    try {
      await para.signTransaction(wallet.id, {
        to: TOKENS.USDT.address,
        chainId: 42220,
        type: 2,
        value: "0",
        data: outsideCall,
        nonce: nonce + 1,
        gasLimit: "100000",
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      });
      record("guardrail-blocks", false, "approve(dEaD) was signed: no active Guardrail covered it");
    } catch (error) {
      const denied = error instanceof ParaRestError && error.code === "POLICY_DENIED";
      record("guardrail-blocks", denied, error instanceof Error ? error.message : String(error));
    }

    // 4b. The allowed call — approve(Textile reactor) on USDT — must still be signed (not broadcast).
    const allowedCall = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: ["0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3", 1n],
    });
    try {
      await para.signTransaction(wallet.id, {
        to: TOKENS.USDT.address,
        chainId: 42220,
        type: 2,
        value: "0",
        data: allowedCall,
        nonce: nonce + 1,
        gasLimit: "100000",
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      });
      record("guardrail-allows-reactor-approve", true, "approve(reactor) was signed (not broadcast)");
    } catch (error) {
      record("guardrail-allows-reactor-approve", false, error instanceof Error ? error.message : String(error));
    }
  }

  // 5. CIP-64 (USDT gas) via sign-raw. Not broadcast: the spike wallet holds no USDT.
  const cip64 = {
    type: "cip64" as const,
    chainId: 42220,
    to: address,
    data: tagData,
    value: 0n,
    nonce: nonce + 1,
    gas: 80_000n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    feeCurrency: TOKENS.USDT.feeCurrency,
  };
  const digest = keccak256(serializeTransaction(cip64));
  const parts = rawSignatureToParts(await para.signRaw(wallet.id, digest));
  const cip64Signer = await recoverAddress({ hash: digest, signature: serializeSignature(parts) });
  record("sign-raw-cip64", isAddressEqual(cip64Signer, address), `recovered ${cip64Signer} (sign-raw bypasses Guardrails)`);

  console.log("\nRESULTS");
  console.table(results);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
