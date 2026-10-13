// src/lib/payments/reconcile.ts
import { and, eq, inArray, lt } from "drizzle-orm";
import { getAddress, parseAbiItem, type Address, type Hex } from "viem";
import type { createCeloPublicClient } from "@/lib/chain/clients";
import { TOKENS } from "@/lib/chain/tokens";
import type { Db } from "@/lib/db/client";
import { invoiceQuotes, invoices, payments, treasuryWallets, type InvoiceQuoteRow } from "@/lib/db/schema";
import { logEvent } from "@/lib/treasury/repo";
import { recordPayment, releaseInvoice, SETTLING_HOLD_MS } from "./invoice-claim";

export interface FoundTransfer {
  txHash: Hex;
  from: Address;
}
/** Returns every Transfer of exactly `amount` to `to` since `since`, so the caller can skip ones already recorded. */
export type FindTransfer = (input: { token: Address; to: Address; amount: bigint; since: Date }) => Promise<FoundTransfer[]>;

/**
 * Plan 2 ruling on unknown x402 outcomes (spec §12): once an invoice's hold has expired, no signed
 * authorization can still land. Record the transfer if one arrived, otherwise reopen the invoice.
 * A transfer already recorded in `payments` is never matched again.
 */
export async function reconcileSettlements(db: Db, find: FindTransfer, now: Date): Promise<{ recorded: number; reopened: number }> {
  const stuck = await db
    .select({
      id: invoices.id,
      slug: invoices.slug,
      userId: invoices.userId,
      settlingUntil: invoices.settlingUntil,
      treasury: treasuryWallets.address,
    })
    .from(invoices)
    .innerJoin(treasuryWallets, eq(treasuryWallets.userId, invoices.userId))
    .where(and(eq(invoices.status, "settling"), lt(invoices.settlingUntil, now)));

  let recorded = 0;
  let reopened = 0;
  for (const invoice of stuck) {
    const quotes = await db.select().from(invoiceQuotes).where(eq(invoiceQuotes.invoiceId, invoice.id));
    const found =
      invoice.treasury && invoice.settlingUntil
        ? await findPayment(db, find, quotes, getAddress(invoice.treasury), invoice.settlingUntil)
        : null;
    if (found) {
      await recordPayment(db, {
        invoiceId: invoice.id,
        payer: found.from,
        asset: found.asset,
        amountAtomic: found.amount,
        txHash: found.txHash,
        now,
      });
      await logEvent(
        db,
        invoice.userId,
        "payment_reconciled",
        { invoiceSlug: invoice.slug, asset: found.asset, amount: found.amount.toString(), txHash: found.txHash },
        now,
      );
      recorded += 1;
    } else {
      await releaseInvoice(db, invoice.id);
      reopened += 1;
    }
  }
  return { recorded, reopened };
}

async function findPayment(db: Db, find: FindTransfer, quotes: InvoiceQuoteRow[], treasury: Address, settlingUntil: Date) {
  // The claim began one hold before settlingUntil; a minute of slack covers clock differences.
  const since = new Date(settlingUntil.getTime() - SETTLING_HOLD_MS - 60_000);
  for (const quote of quotes) {
    const amount = BigInt(quote.amountAtomic);
    const hits = await find({ token: TOKENS[quote.asset].address, to: treasury, amount, since });
    if (hits.length === 0) continue;
    const known = await db
      .select({ txHash: payments.txHash })
      .from(payments)
      .where(inArray(payments.txHash, hits.map((hit) => hit.txHash)));
    const recorded = new Set(known.map((row) => row.txHash.toLowerCase()));
    const hit = hits.find((candidate) => !recorded.has(candidate.txHash.toLowerCase()));
    if (hit) return { ...hit, asset: quote.asset, amount };
  }
  return null;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** Celo makes one block per second. Never look back more than a day. */
const MAX_LOOKBACK_BLOCKS = 86_400n;
const MARGIN_BLOCKS = 120n;

export function logTransferFinder(
  client: Pick<ReturnType<typeof createCeloPublicClient>, "getBlockNumber" | "getLogs">,
  now: () => number = Date.now,
): FindTransfer {
  return async ({ token, to, amount, since }) => {
    const latest = await client.getBlockNumber();
    const back = BigInt(Math.max(0, Math.ceil((now() - since.getTime()) / 1000))) + MARGIN_BLOCKS;
    const span = back < MAX_LOOKBACK_BLOCKS ? back : MAX_LOOKBACK_BLOCKS;
    const logs = await client.getLogs({
      address: token,
      event: TRANSFER,
      args: { to },
      fromBlock: latest > span ? latest - span : 0n,
      toBlock: latest,
    });
    return logs.flatMap((log) =>
      log.args.value === amount && log.args.from ? [{ txHash: log.transactionHash, from: getAddress(log.args.from) }] : [],
    );
  };
}
