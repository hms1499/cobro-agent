/** What the event's "independent user" rule needs to know about a wallet. Addresses are lowercase. */
export interface WalletHistory {
  firstActivityAt: Date | null;
  firstFunder: string | null;
}

interface BlockscoutRow {
  timeStamp: string;
  from: string;
  to: string;
}

const BLOCKSCOUT = "https://celo.blockscout.com/api";

/** The oldest row of one Blockscout account list (normal transactions or token transfers). */
async function firstRow(fetchFn: typeof fetch, base: string, action: "txlist" | "tokentx", address: string): Promise<BlockscoutRow | null> {
  const url = `${base}?module=account&action=${action}&address=${address}&sort=asc&page=1&offset=1`;
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`Blockscout ${action} for ${address} returned HTTP ${response.status}`);
  const body = (await response.json()) as { status: string; message: string; result: BlockscoutRow[] | null };
  if (body.status !== "1") {
    if (body.message === "No transactions found") return null;
    throw new Error(`Blockscout ${action} for ${address}: ${body.message}`);
  }
  return body.result?.[0] ?? null;
}

/**
 * The wallet's first activity on Celo and who first sent it something, from the earliest normal transaction
 * and the earliest token transfer. A wallet with neither has no history (nulls); any API failure throws.
 */
export async function fetchWalletHistory(address: string, fetchFn: typeof fetch, base = BLOCKSCOUT): Promise<WalletHistory> {
  const self = address.toLowerCase();
  const rows = (await Promise.all([firstRow(fetchFn, base, "txlist", self), firstRow(fetchFn, base, "tokentx", self)]))
    .filter((row): row is BlockscoutRow => row !== null)
    .sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp));
  if (rows.length === 0) return { firstActivityAt: null, firstFunder: null };
  const incoming = rows.find((row) => row.to.toLowerCase() === self);
  return {
    firstActivityAt: new Date(Number(rows[0].timeStamp) * 1000),
    firstFunder: incoming ? incoming.from.toLowerCase() : null,
  };
}
