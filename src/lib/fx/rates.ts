import { z } from "zod";
import { parseServerEnv } from "@/lib/config/server";
import type { LocalCurrency } from "@/lib/money/currencies";
import { parseDecimal, RATE_DECIMALS } from "@/lib/money/decimal";

/** Local-currency units per 1 USD₮, 18 decimals, from Textile's public tickers (spec §8.3). */
export interface ReferenceRates {
  perUsd: Record<LocalCurrency, bigint>;
  fetchedAt: number;
}

export class RatesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatesUnavailableError";
  }
}

const PAIRS: Record<LocalCurrency, string> = { ARS: "USDT_WARS", BRL: "USDT_WBRL" };

const tickerSchema = z.object({
  ticker_id: z.string(),
  bid: z.string(),
  ask: z.string(),
  last_price: z.string(),
});

function priceOf(value: string, pair: string): bigint {
  try {
    return parseDecimal(value, RATE_DECIMALS);
  } catch {
    throw new RatesUnavailableError(`Textile ${pair} has a malformed price "${value}"`);
  }
}

/** Mid of bid and ask; one live side if the other is 0; else the last trade. Never 0. */
function referencePrice(ticker: z.infer<typeof tickerSchema>): bigint {
  const bid = priceOf(ticker.bid, ticker.ticker_id);
  const ask = priceOf(ticker.ask, ticker.ticker_id);
  if (bid > 0n && ask > 0n) return (bid + ask) / 2n;
  if (bid > 0n || ask > 0n) return bid > 0n ? bid : ask;
  const last = priceOf(ticker.last_price, ticker.ticker_id);
  if (last > 0n) return last;
  throw new RatesUnavailableError(`Textile ${ticker.ticker_id} has no price`);
}

export function parseTickers(json: unknown, now: number): ReferenceRates {
  const parsed = z.array(z.unknown()).safeParse(json);
  if (!parsed.success) throw new RatesUnavailableError("Textile tickers response is not a list");
  const tickers = new Map<string, z.infer<typeof tickerSchema>>();
  for (const item of parsed.data) {
    const ticker = tickerSchema.safeParse(item);
    if (ticker.success) tickers.set(ticker.data.ticker_id, ticker.data);
  }
  const perUsd = {} as Record<LocalCurrency, bigint>;
  for (const [currency, pair] of Object.entries(PAIRS) as [LocalCurrency, string][]) {
    const ticker = tickers.get(pair);
    if (!ticker) throw new RatesUnavailableError(`Textile tickers have no ${pair}`);
    perUsd[currency] = referencePrice(ticker);
  }
  return { perUsd, fetchedAt: now };
}

export async function fetchReferenceRates(opts: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<ReferenceRates> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/tickers`, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new RatesUnavailableError(`Textile tickers unreachable: ${error instanceof Error ? error.message : error}`);
  }
  if (!response.ok) throw new RatesUnavailableError(`Textile tickers returned ${response.status}`);
  return parseTickers(await response.json().catch(() => null), (opts.now ?? Date.now)());
}

/** Fresh for ttlMs; on a failed refresh, keeps serving a value younger than maxStaleMs. */
export function createRatesCache(
  load: () => Promise<ReferenceRates>,
  opts: { ttlMs?: number; maxStaleMs?: number; now?: () => number } = {},
): () => Promise<ReferenceRates> {
  const ttlMs = opts.ttlMs ?? 60_000;
  const maxStaleMs = opts.maxStaleMs ?? 600_000;
  const now = opts.now ?? Date.now;
  let last: { value: ReferenceRates; at: number } | undefined;
  return async () => {
    const time = now();
    if (last && time - last.at < ttlMs) return last.value;
    try {
      const value = await load();
      last = { value, at: time };
      return value;
    } catch (error) {
      if (last && time - last.at < maxStaleMs) return last.value;
      throw error;
    }
  };
}

let shared: (() => Promise<ReferenceRates>) | undefined;

export function getReferenceRates(): Promise<ReferenceRates> {
  shared ??= createRatesCache(() => fetchReferenceRates({ baseUrl: parseServerEnv().TEXTILE_API_URL }));
  return shared();
}

/** For views that can render without rates (the dashboard falls back to invoice currency). */
export async function getReferenceRatesOrNull(): Promise<ReferenceRates | null> {
  try {
    return await getReferenceRates();
  } catch {
    return null;
  }
}
