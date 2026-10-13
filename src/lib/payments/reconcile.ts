// src/lib/payments/reconcile.ts
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { getAddress, parseAbiItem, type Address, type Hex } from "viem";
import type { createCeloPublicClient } from "@/lib/chain/clients";
import { TOKENS } from "@/lib/chain/tokens";
import type { Db } from "@/lib/db/client";
import { invoiceQuotes, invoices, payments, treasuryWallets } from "@/lib/db/schema";
import { logEvent } from "@/lib/treasury/repo";
import { recordReconciledPayment, releaseSettling, SETTLING_HOLD_MS } from "./invoice-claim";

export interface FoundTransfer {
  txHash: Hex;
  from: Address;
}
/**
 * Returns every Transfer of exactly `amount` to `to` mined between `since` and `until`, so the caller
 * can skip ones already recorded.
 */
export type FindTransfer = (input: { token: Address; to: Address; amount: bigint; since: Date; until: Date }) => Promise<FoundTransfer[]>;

export interface ReconcileResult {
  recorded: number;
  reopened: number;
  errors: number;
}

/** Slack after the hold in which a late transfer could still be mined. */
const UNTIL_SLACK_MS = 60_000;

/**
 * Plan 2 ruling on unknown x402 outcomes (spec §12): once an invoice's hold has expired, no signed
 * authorization can still land. Record the transfer if one arrived, otherwise reopen the invoice.
 * A transfer already recorded in `payments` is never matched again, and every write is guarded on
 * the claim we read, so a newer claim or a concurrent reconcile is never overwritten.
 */
export async function reconcileSettlements(db: Db, find: FindTransfer, now: Date): Promise<ReconcileResult> {
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
    .where(and(eq(invoices.status, "settling"), lt(invoices.settlingUntil, now)))
    .orderBy(asc(invoices.settlingUntil));

  const result: ReconcileResult = { recorded: 0, reopened: 0, errors: 0 };
  for (const invoice of stuck) {
    try {
      const settlingUntil = invoice.settlingUntil;
      if (!settlingUntil) continue;
      // The claim began one hold before settlingUntil; a minute of slack covers clock differences.
      const since = new Date(settlingUntil.getTime() - SETTLING_HOLD_MS - 60_000);
      const until = new Date(settlingUntil.getTime() + UNTIL_SLACK_MS);
      const quotes = await db.select().from(invoiceQuotes).where(eq(invoiceQuotes.invoiceId, invoice.id));

      let outcome: "recorded" | "moved" | "none" = "none";
      if (invoice.treasury) {
        const treasury = getAddress(invoice.treasury);
        search: for (const quote of quotes) {
          const amount = BigInt(quote.amountAtomic);
          const hits = await find({ token: TOKENS[quote.asset].address, to: treasury, amount, since, until });
          if (hits.length === 0) continue;
          const known = await db
            .select({ txHash: payments.txHash })
            .from(payments)
            .where(sql`lower(${payments.txHash}) in (${sql.join(hits.map((hit) => sql`${hit.txHash.toLowerCase()}`), sql`, `)})`);
          const recorded = new Set(known.map((row) => row.txHash.toLowerCase()));
          for (const hit of hits) {
            if (recorded.has(hit.txHash.toLowerCase())) continue;
            const status = await recordReconciledPayment(db, {
              invoiceId: invoice.id,
              settlingUntil,
              payer: hit.from,
              asset: quote.asset,
              amountAtomic: amount,
              txHash: hit.txHash,
              now,
            });
            if (status === "duplicate") continue; // another process took this transfer; try the next candidate
            if (status === "moved") {
              outcome = "moved";
              break search;
            }
            await logEvent(
              db,
              invoice.userId,
              "payment_reconciled",
              { invoiceSlug: invoice.slug, asset: quote.asset, amount: amount.toString(), txHash: hit.txHash },
              now,
            );
            outcome = "recorded";
            break search;
          }
        }
      }
      if (outcome === "recorded") result.recorded += 1;
      else if (outcome === "none" && (await releaseSettling(db, invoice.id, settlingUntil))) result.reopened += 1;
    } catch (error) {
      console.error(`Settlement reconciliation failed for invoice ${invoice.slug}:`, error);
      result.errors += 1;
    }
  }
  return result;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** Celo makes one block per second. */
const MARGIN_BLOCKS = 120n;
/** Cap on the size of one search window (not on its distance from now). */
const MAX_WINDOW_BLOCKS = 86_400n;

export function logTransferFinder(
  client: Pick<ReturnType<typeof createCeloPublicClient>, "getBlockNumber" | "getLogs">,
  now: () => number = Date.now,
): FindTransfer {
  // One getBlockNumber per run; block numbers for other times are derived from it.
  let head: Promise<{ latest: bigint; at: number }> | undefined;
  const getHead = () => (head ??= (async () => ({ at: now(), latest: await client.getBlockNumber() }))());
  const blockAt = (h: { latest: bigint; at: number }, time: Date) => {
    const secondsBack = BigInt(Math.max(0, Math.round((h.at - time.getTime()) / 1000)));
    return h.latest > secondsBack ? h.latest - secondsBack : 0n;
  };
  return async ({ token, to, amount, since, until }) => {
    const h = await getHead();
    const toBlock = (() => {
      const b = blockAt(h, until) + MARGIN_BLOCKS;
      return b < h.latest ? b : h.latest;
    })();
    let fromBlock = blockAt(h, since) > MARGIN_BLOCKS ? blockAt(h, since) - MARGIN_BLOCKS : 0n;
    if (toBlock - fromBlock > MAX_WINDOW_BLOCKS) fromBlock = toBlock - MAX_WINDOW_BLOCKS;
    const logs = await client.getLogs({ address: token, event: TRANSFER, args: { to }, fromBlock, toBlock });
    return logs.flatMap((log) =>
      log.args.value === amount && log.args.from ? [{ txHash: log.transactionHash, from: getAddress(log.args.from) }] : [],
    );
  };
}
