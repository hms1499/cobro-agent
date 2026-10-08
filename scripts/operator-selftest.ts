import { verifyTx } from "@celo/attribution-tags";
import { erc20Abi, formatUnits } from "viem";
import { createCeloPublicClient, createOperatorClient, operatorSendParams } from "@/lib/chain/clients";
import { TOKENS } from "@/lib/chain/tokens";
import { readPublicEnv } from "@/lib/config/public";
import { parseServerEnv, requireValue } from "@/lib/config/server";

async function main() {
  const server = parseServerEnv();
  const pub = readPublicEnv();
  const feeToken = server.OPERATOR_FEE_TOKEN;
  const code = pub.NEXT_PUBLIC_ATTRIBUTION_CODE;

  const publicClient = createCeloPublicClient(server.CELO_RPC_URL);
  const operator = createOperatorClient({
    privateKey: requireValue(server.OPERATOR_PRIVATE_KEY, "OPERATOR_PRIVATE_KEY"),
    attributionCode: code,
    rpcUrl: server.CELO_RPC_URL,
  });
  const address = operator.account.address;

  const balance =
    feeToken === "CELO"
      ? await publicClient.getBalance({ address })
      : await publicClient.readContract({
          address: TOKENS[feeToken].address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
  const decimals = feeToken === "CELO" ? 18 : TOKENS[feeToken].decimals;
  console.log(`Operator ${address} holds ${formatUnits(balance, decimals)} ${feeToken}`);
  if (balance === 0n) {
    console.error(`Fund ${address} with a little ${feeToken} on Celo mainnet, then run this again.`);
    process.exit(2);
  }

  const hash = await operator.sendTransaction({ to: address, value: 0n, ...operatorSendParams(feeToken) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const decoded = await verifyTx({ client: publicClient, hash });
  console.log(`status: ${receipt.status}`);
  console.log(`codes: ${decoded?.codes.join(", ") ?? "none"}`);
  console.log(`https://celoscan.io/tx/${hash}`);
  if (receipt.status !== "success" || !decoded?.codes.includes(code)) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
