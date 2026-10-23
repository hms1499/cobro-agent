import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { fxTrades, invoices, payments, treasuryTxs, users } from "@/lib/db/schema";
import type { ReferenceRates } from "@/lib/fx/rates";
import { ASSET_DENOMINATION, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal, RATE_DECIMALS } from "@/lib/money/decimal";
import { ratesAtPayment } from "@/lib/treasury/pnl";
import { usdWad } from "@/lib/treasury/value";
import type { WalletHistory } from "./wallet-history";

/** The team's own accounts and wallets, never counted as outside usage. Read from a git-ignored JSON file. */
export interface Exclusions {
  emails: string[];
  wallets: string[];
}

export interface UsageRows {
  users: { id: string; email: string | null; createdAt: Date }[];
  payments: {
    freelancerId: string;
    payer: string;
    asset: PayAsset;
    amountAtomic: bigint;
    txHash: string;
    ratesSnapshot: Record<string, string> | null;
    settledAt: Date;
    recurring: boolean;
  }[];
  swaps: { userId: string; txHash: string; notionalUsdCents: number; filledAt: Date }[];
  withdrawals: { userId: string; hash: string; usdCents: number | null; confirmedAt: Date }[];
}

/** Who stands behind a row of the activity table. "new wallet": outside, but created after the window opened. */
export type ActivityRole = "independent client" | "team" | "new wallet" | "unverified" | "agent";

export interface UsageReport {
  outsideFreelancers: number;
  independentPayers: number;
  unverifiedPayers: number;
  /** The counts and volume below cover independent payments only. */
  payments: number;
  paymentsByAsset: Record<PayAsset, number>;
  repeatPayers: number;
  repeatUsatPayers: number;
  volumeUsdCents: number;
  /** Independent local-currency payments priced with today's rate because their snapshot lacked one. */
  todayRatePayments: number;
  swaps: number;
  swapVolumeUsdCents: number;
  withdrawals: number;
  activity: { at: Date; kind: "payment" | "swap" | "withdrawal"; asset?: PayAsset; usdCents: number | null; role: ActivityRole; txHash: string }[];
}

export async function loadUsageRows(db: Db): Promise<UsageRows> {
  const userRows = await db.select({ id: users.id, email: users.email, createdAt: users.createdAt }).from(users);
  const paymentRows = await db
    .select({
      freelancerId: invoices.userId,
      payer: payments.payer,
      asset: payments.asset,
      amountAtomic: payments.amountAtomic,
      txHash: payments.txHash,
      ratesSnapshot: payments.ratesSnapshot,
      settledAt: payments.settledAt,
      recurringId: invoices.recurringId,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId));
  const swapRows = await db
    .select({ userId: fxTrades.userId, txHash: fxTrades.swapTxHash, notionalUsdCents: fxTrades.notionalUsdCents, filledAt: fxTrades.filledAt })
    .from(fxTrades)
    .where(and(eq(fxTrades.status, "filled"), isNotNull(fxTrades.swapTxHash), isNotNull(fxTrades.filledAt)));
  const withdrawalRows = await db
    .select({ userId: treasuryTxs.userId, hash: treasuryTxs.hash, usdCents: treasuryTxs.usdCents, confirmedAt: treasuryTxs.confirmedAt })
    .from(treasuryTxs)
    .where(and(eq(treasuryTxs.kind, "withdraw"), eq(treasuryTxs.status, "success"), isNotNull(treasuryTxs.confirmedAt)));
  return {
    users: userRows,
    payments: paymentRows.map(({ recurringId, amountAtomic, ratesSnapshot, ...row }) => ({
      ...row,
      amountAtomic: BigInt(amountAtomic),
      ratesSnapshot: ratesSnapshot ?? null,
      recurring: recurringId !== null,
    })),
    swaps: swapRows.map((row) => ({ userId: row.userId, txHash: row.txHash!, notionalUsdCents: row.notionalUsdCents, filledAt: row.filledAt! })),
    withdrawals: withdrawalRows.map((row) => ({ userId: row.userId, hash: row.hash, usdCents: row.usdCents, confirmedAt: row.confirmedAt! })),
  };
}

/** Whether the snapshot holds a usable rate for this asset's currency (USD assets need none). */
function snapshotPrices(asset: PayAsset, snapshot: Record<string, string> | null): boolean {
  const currency = ASSET_DENOMINATION[asset];
  if (currency === "USD") return true;
  const value = snapshot?.[currency];
  if (!value) return false;
  try {
    parseDecimal(value, RATE_DECIMALS);
    return true;
  } catch {
    return false;
  }
}

function payerRole(payer: string, team: Set<string>, history: WalletHistory | "error" | undefined, windowStart: Date): ActivityRole {
  if (team.has(payer)) return "team";
  if (history === undefined || history === "error" || history.firstActivityAt === null) return "unverified";
  if (history.firstFunder !== null && team.has(history.firstFunder)) return "team";
  return history.firstActivityAt < windowStart ? "independent client" : "new wallet";
}

/** Usage since `windowStart`, by the event's rule: a payer is independent when it is not ours, not funded by us and older than the event. */
export function computeUsage(
  rows: UsageRows,
  exclusions: Exclusions,
  histories: Map<string, WalletHistory | "error">,
  nowRates: ReferenceRates,
  windowStart: Date,
): UsageReport {
  const teamEmails = new Set(exclusions.emails.map((e) => e.toLowerCase()));
  const team = new Set(exclusions.wallets.map((w) => w.toLowerCase()));
  const report: UsageReport = {
    outsideFreelancers: rows.users.filter((u) => u.createdAt >= windowStart && u.email !== null && !teamEmails.has(u.email.toLowerCase())).length,
    independentPayers: 0,
    unverifiedPayers: 0,
    payments: 0,
    paymentsByAsset: { USAT: 0, USDT: 0, WARS: 0, WBRL: 0 },
    repeatPayers: 0,
    repeatUsatPayers: 0,
    volumeUsdCents: 0,
    todayRatePayments: 0,
    swaps: 0,
    swapVolumeUsdCents: 0,
    withdrawals: 0,
    activity: [],
  };

  const independent = new Set<string>();
  const unverified = new Set<string>();
  const perPair = new Map<string, { all: number; usat: number }>();
  for (const p of rows.payments) {
    if (p.settledAt < windowStart) continue;
    const payer = p.payer.toLowerCase();
    const role = payerRole(payer, team, histories.get(payer), windowStart);
    const usdCents = Number(usdWad(p.asset, p.amountAtomic, ratesAtPayment(p.ratesSnapshot, nowRates)) / 10n ** 16n);
    report.activity.push({ at: p.settledAt, kind: "payment", asset: p.asset, usdCents, role, txHash: p.txHash });
    if (role === "unverified") unverified.add(payer);
    if (role !== "independent client") continue;
    independent.add(payer);
    report.payments += 1;
    report.paymentsByAsset[p.asset] += 1;
    report.volumeUsdCents += usdCents;
    if (!snapshotPrices(p.asset, p.ratesSnapshot)) report.todayRatePayments += 1;
    const key = `${payer}:${p.freelancerId}`;
    const pair = perPair.get(key) ?? { all: 0, usat: 0 };
    pair.all += 1;
    if (p.asset === "USAT") pair.usat += 1;
    perPair.set(key, pair);
  }
  const repeat = new Set<string>();
  const repeatUsat = new Set<string>();
  for (const [key, pair] of perPair) {
    const payer = key.split(":")[0];
    if (pair.all >= 2) repeat.add(payer);
    if (pair.usat >= 2) repeatUsat.add(payer);
  }
  report.independentPayers = independent.size;
  report.unverifiedPayers = unverified.size;
  report.repeatPayers = repeat.size;
  report.repeatUsatPayers = repeatUsat.size;

  // The agent's work on the team's own treasuries is shown as team activity and left out of the counts.
  const teamUsers = new Set(rows.users.filter((u) => u.email !== null && teamEmails.has(u.email.toLowerCase())).map((u) => u.id));
  for (const s of rows.swaps) {
    if (s.filledAt < windowStart) continue;
    const role = teamUsers.has(s.userId) ? "team" : "agent";
    report.activity.push({ at: s.filledAt, kind: "swap", usdCents: s.notionalUsdCents, role, txHash: s.txHash });
    if (role === "team") continue;
    report.swaps += 1;
    report.swapVolumeUsdCents += s.notionalUsdCents;
  }
  for (const w of rows.withdrawals) {
    if (w.confirmedAt < windowStart) continue;
    const role = teamUsers.has(w.userId) ? "team" : "agent";
    report.activity.push({ at: w.confirmedAt, kind: "withdrawal", usdCents: w.usdCents, role, txHash: w.hash });
    if (role === "team") continue;
    report.withdrawals += 1;
  }
  report.activity.sort((a, b) => b.at.getTime() - a.at.getTime());
  return report;
}

const ASSET_LABEL: Record<PayAsset, string> = { USAT: "USA₮", USDT: "USD₮", WARS: "wARS", WBRL: "wBRL" };

function usd(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const KIND_LABEL = { payment: "Invoice payment", swap: "Agent swap (Textile FX)", withdrawal: "Agent withdrawal" } as const;

/** The README's usage block. Rows name roles and link transactions; no emails, no bare addresses. */
export function renderUsageMarkdown(report: UsageReport, generatedAt: Date): string {
  const byAsset = (Object.keys(report.paymentsByAsset) as PayAsset[])
    .filter((asset) => report.paymentsByAsset[asset] > 0)
    .map((asset) => `${report.paymentsByAsset[asset]} ${ASSET_LABEL[asset]}`)
    .join(", ");
  const summary = [
    "| Metric | Value |",
    "|---|---|",
    `| Outside freelancers signed up | ${report.outsideFreelancers} |`,
    `| Independent paying clients | ${report.independentPayers} |`,
    `| Payments from independent clients | ${report.payments}${byAsset ? ` (${byAsset})` : ""} |`,
    `| Clients who paid the same freelancer again | ${report.repeatPayers} (in USA₮: ${report.repeatUsatPayers}) |`,
    `| Volume from independent clients | ${usd(report.volumeUsdCents)} |`,
    `| Agent swaps on Textile FX | ${report.swaps} (${usd(report.swapVolumeUsdCents)}) |`,
    `| Agent withdrawals | ${report.withdrawals} |`,
  ];
  const notes = [
    `_Generated ${generatedAt.toISOString().slice(0, 10)} by \`scripts/usage-stats.mts\` from Cobro's database and Celo mainnet._`,
  ];
  if (report.unverifiedPayers > 0) notes.push(`_${report.unverifiedPayers} payer wallet(s) could not be verified and are not counted as independent._`);
  if (report.todayRatePayments > 0) notes.push(`_${report.todayRatePayments} local-currency payment(s) priced at today's rate (no rate stored at payment time)._`);
  const activity = [
    "| Date | What | USD | Who | Tx |",
    "|---|---|---|---|---|",
    ...report.activity.map(
      (a) =>
        `| ${a.at.toISOString().slice(0, 10)} | ${KIND_LABEL[a.kind]}${a.asset ? ` in ${ASSET_LABEL[a.asset]}` : ""} | ${usd(a.usdCents)} | ${a.role} | [tx](https://celoscan.io/tx/${a.txHash.toLowerCase()}) |`,
    ),
  ];
  return [...summary, "", ...notes, "", ...activity].join("\n");
}

const START = "<!-- usage:start -->";
const END = "<!-- usage:end -->";

const count = (text: string, marker: string) => text.split(marker).length - 1;

/** Puts `block` between the README's usage markers; refuses unless each marker appears exactly once, start first. */
export function replaceUsageBlock(readme: string, block: string): string {
  for (const marker of [START, END]) {
    const n = count(readme, marker);
    if (n === 0) throw new Error(`README has no ${marker} marker`);
    if (n > 1) throw new Error(`README must contain ${marker} exactly once (found ${n})`);
  }
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (end < start) throw new Error(`${END} comes before ${START}`);
  return `${readme.slice(0, start + START.length)}\n${block}\n${readme.slice(end)}`;
}
