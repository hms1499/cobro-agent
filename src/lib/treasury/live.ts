// src/lib/treasury/live.ts
import { eq } from "drizzle-orm";
import {
  erc20Abi,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import { createCeloPublicClient } from "@/lib/chain/clients";
import { isNodeRejection, signTreasuryTx, TEXTILE_REACTOR } from "@/lib/chain/treasury-tx";
import { readPublicEnv } from "@/lib/config/public";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { getDb } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { getReferenceRates } from "@/lib/fx/rates";
import { TextileRfqClient } from "@/lib/fx/rfq";
import { paraTreasurySigner } from "@/lib/signer/treasury-signer";
import { paraRestClient } from "@/lib/users/para";
import { erc20Balance, readTreasuryBalances } from "./balances";
import { runTreasuryForUser, TxRejectedError, type ExecutorDeps } from "./executor";
import { operatorDripper } from "./gas";

/** One run is an RFQ (up to 75 s) plus up to 3 receipt waits; it must fit the 300 s wallet lock, which is never renewed. */
const RECEIPT_TIMEOUT_MS = 45_000;
let cached: ExecutorDeps | undefined;

/** Real chain, Para, Textile and operator wiring, built once per server instance. */
export function liveExecutorDeps(): ExecutorDeps {
  if (cached) return cached;
  const env = parseServerEnv();
  const code = readPublicEnv().NEXT_PUBLIC_ATTRIBUTION_CODE;
  const client = createCeloPublicClient(env.CELO_RPC_URL);
  const para = paraRestClient();
  const read = erc20Balance(client);
  cached = {
    db: getDb(),
    now: () => new Date(),
    flags: { enabled: env.TREASURY_ENABLED, dryRun: env.TREASURY_DRY_RUN },
    rates: getReferenceRates,
    chain: {
      readBalances: (owner) => readTreasuryBalances(read, owner),
      allowance: (token, owner, spender) =>
        client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
      async receipt(hash) {
        try {
          return (await client.getTransactionReceipt({ hash })).status;
        } catch (error) {
          if (error instanceof TransactionReceiptNotFoundError) return null;
          throw error;
        }
      },
      confirmedNonce: (owner) => client.getTransactionCount({ address: owner, blockTag: "latest" }),
      async knownTx(hash) {
        try {
          await client.getTransaction({ hash });
          return true;
        } catch (error) {
          if (error instanceof TransactionNotFoundError) return false;
          throw error;
        }
      },
      async sendRaw(raw) {
        try {
          await client.sendRawTransaction({ serializedTransaction: raw });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/already known|known transaction/i.test(message)) return;
          if (isNodeRejection(error)) throw new TxRejectedError(message, { cause: error });
          throw error;
        }
      },
      async waitForReceipt(hash) {
        try {
          return (await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS })).status;
        } catch (error) {
          if (error instanceof WaitForTransactionReceiptTimeoutError) return null;
          throw error;
        }
      },
    },
    signer: (ctx) => paraTreasurySigner(para, { id: ctx.paraWalletId, address: ctx.address }),
    signTx: (signer, call, feeToken) => signTreasuryTx({ client, signer, attributionCode: code }, call, feeToken),
    rfq: new TextileRfqClient({ baseUrl: env.TEXTILE_API_URL }),
    // The operator key is read only when a wallet actually needs gas.
    drip: (to, amount) =>
      operatorDripper({
        privateKey: requireValue(env.OPERATOR_PRIVATE_KEY, "OPERATOR_PRIVATE_KEY"),
        attributionCode: code,
        rpcUrl: env.CELO_RPC_URL,
        feeToken: env.OPERATOR_FEE_TOKEN,
      })(to, amount),
    allowedSpenders: [TEXTILE_REACTOR],
  };
  return cached;
}

/** Spec §7.3: a settled payment schedules a treasury run for the invoice's owner. Called from after(). */
export async function runTreasuryAfterPayment(slug: string): Promise<void> {
  try {
    if (!parseServerEnv().TREASURY_ENABLED) return;
    const deps = liveExecutorDeps();
    const [invoice] = await deps.db.select({ userId: invoices.userId }).from(invoices).where(eq(invoices.slug, slug));
    if (invoice) await runTreasuryForUser(deps, invoice.userId);
  } catch (error) {
    console.error(`Treasury run after payment ${slug} failed:`, error);
  }
}
