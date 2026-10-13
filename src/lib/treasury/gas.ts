import { and, eq, isNull, lt, or } from "drizzle-orm";
import { erc20Abi, type Address, type Hex } from "viem";
import { createCeloPublicClient, createOperatorClient, operatorSendParams } from "@/lib/chain/clients";
import { TOKENS, type FeeToken } from "@/lib/chain/tokens";
import type { Db } from "@/lib/db/client";
import { treasuryWallets } from "@/lib/db/schema";

/** 0.05 USDC: gas for a dozen or more treasury transactions. */
export const DRIP_AMOUNT_ATOMIC = 50_000n;
export const DRIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type Dripper = (to: Address, amount: bigint) => Promise<Hex>;

/** Operator → treasury USDC transfer, tagged, gas in the operator's fee token. Resolves after a successful receipt. */
export function operatorDripper(opts: { privateKey: Hex; attributionCode: string; rpcUrl: string; feeToken: FeeToken }): Dripper {
  const operator = createOperatorClient(opts);
  const publicClient = createCeloPublicClient(opts.rpcUrl);
  return async (to, amount) => {
    const hash = await operator.writeContract({
      address: TOKENS.USDC.address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amount],
      ...operatorSendParams(opts.feeToken),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`Gas drip ${hash} reverted`);
    return hash;
  };
}

/** Takes this wallet's drip slot: false when it already had a drip in the last 24 hours. */
export async function claimDrip(db: Db, walletId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(treasuryWallets)
    .set({ gasDrippedAt: now })
    .where(
      and(
        eq(treasuryWallets.id, walletId),
        or(isNull(treasuryWallets.gasDrippedAt), lt(treasuryWallets.gasDrippedAt, new Date(now.getTime() - DRIP_COOLDOWN_MS))),
      ),
    )
    .returning({ id: treasuryWallets.id });
  return rows.length === 1;
}
