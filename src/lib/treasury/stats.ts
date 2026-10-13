// src/lib/treasury/stats.ts
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import {
  fxTrades,
  invoices,
  payments,
  recurringInvoices,
  treasuryTxs,
  type FxTradeRow,
  type RecurringInterval,
} from "@/lib/db/schema";
import type { PaymentForPnl } from "./pnl";

export async function paymentsForPnl(db: Db, userId: string): Promise<PaymentForPnl[]> {
  const rows = await db
    .select({ asset: payments.asset, amountAtomic: payments.amountAtomic, ratesSnapshot: payments.ratesSnapshot })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(eq(invoices.userId, userId));
  return rows.map((row) => ({ asset: row.asset, amountAtomic: BigInt(row.amountAtomic), ratesSnapshot: row.ratesSnapshot ?? null }));
}

/** Successful withdrawals, valued in USD when they left (treasury_txs.usd_cents). */
export async function withdrawnUsdWad(db: Db, userId: string): Promise<bigint> {
  const [row] = await db
    .select({ cents: sql`coalesce(sum(${treasuryTxs.usdCents}), 0)`.mapWith(String) })
    .from(treasuryTxs)
    .where(and(eq(treasuryTxs.userId, userId), eq(treasuryTxs.kind, "withdraw"), eq(treasuryTxs.status, "success")));
  return BigInt(row.cents) * 10n ** 16n;
}

export interface VolumeStats {
  requested: number;
  quoted: number;
  filled: number;
  filledUsdCents: number;
}

/** Spec §10.5 volume: RFQs requested, quoted, filled, and filled notional. */
export async function volumeStats(db: Db, userId: string): Promise<VolumeStats> {
  const [row] = await db
    .select({
      requested: sql`count(*)`.mapWith(Number),
      quoted: sql`count(*) filter (where ${fxTrades.status} <> 'no_quote')`.mapWith(Number),
      filled: sql`count(*) filter (where ${fxTrades.status} = 'filled')`.mapWith(Number),
      filledUsdCents: sql`coalesce(sum(${fxTrades.notionalUsdCents}) filter (where ${fxTrades.status} = 'filled'), 0)`.mapWith(Number),
    })
    .from(fxTrades)
    .where(eq(fxTrades.userId, userId));
  return row;
}

export async function recentConversions(db: Db, userId: string, limit = 10): Promise<FxTradeRow[]> {
  return db
    .select()
    .from(fxTrades)
    .where(and(eq(fxTrades.userId, userId), eq(fxTrades.status, "filled")))
    .orderBy(desc(fxTrades.filledAt))
    .limit(limit);
}

export interface RepeatClient {
  recurringId: string;
  clientName: string;
  interval: RecurringInterval;
  paidCount: number;
  payerCount: number;
  lastPaidAt: Date | null;
}

/** Spec §9.1: payments grouped per recurring template, with distinct paying wallets (Track 3 repeat flow). */
export async function repeatClients(db: Db, userId: string): Promise<RepeatClient[]> {
  const lastPaid = sql`max(${payments.settledAt})`;
  const rows = await db
    .select({
      recurringId: recurringInvoices.id,
      clientName: recurringInvoices.clientName,
      interval: recurringInvoices.interval,
      paidCount: sql`count(distinct ${payments.id})`.mapWith(Number),
      payerCount: sql`count(distinct lower(${payments.payer}))`.mapWith(Number),
      lastPaidAt: lastPaid.mapWith((value: string | Date | null) => (value === null ? null : new Date(value))),
    })
    .from(recurringInvoices)
    .leftJoin(invoices, eq(invoices.recurringId, recurringInvoices.id))
    .leftJoin(payments, eq(payments.invoiceId, invoices.id))
    .where(eq(recurringInvoices.userId, userId))
    .groupBy(recurringInvoices.id)
    .orderBy(desc(recurringInvoices.createdAt));
  return rows.map((row) => ({ ...row, lastPaidAt: row.lastPaidAt ?? null }));
}
