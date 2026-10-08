import { verifyTx } from "@celo/attribution-tags";
import type { Hex } from "viem";
import { createCeloPublicClient } from "@/lib/chain/clients";

async function main() {
  const hash = process.argv[2];
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    console.error("usage: npx tsx scripts/verify-tx.ts <0x transaction hash>");
    process.exit(1);
  }
  const client = createCeloPublicClient(process.env.CELO_RPC_URL ?? "https://forno.celo.org");
  const decoded = await verifyTx({ client, hash: hash as Hex });
  console.log(decoded ?? "no attribution tag in this transaction");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
