import { describe, expect, it, vi } from "vitest";
import { convertFiat, fiatPerUsd } from "./convert";
import { createRatesCache, fetchReferenceRates, parseTickers, RatesUnavailableError, type ReferenceRates } from "./rates";

// Shape and values from GET https://api.textilecredit.com/tickers on 2026-10-08.
const TICKERS = [
  { ticker_id: "USDT_WARS", base_currency: "USDT", target_currency: "WARS", last_price: "1606.94", bid: "1605.17", ask: "1605.82" },
  { ticker_id: "USDT_WBRL", base_currency: "USDT", target_currency: "WBRL", last_price: "5.0367", bid: "5.0348", ask: "5.0383" },
  { ticker_id: "USAT_USDT", base_currency: "USAT", target_currency: "USDT", last_price: "0.999450", bid: "0.999450", ask: "0" },
];

const E18 = 10n ** 18n;
const rates: ReferenceRates = { perUsd: { ARS: 1605495n * 10n ** 15n, BRL: 503655n * 10n ** 13n }, fetchedAt: 0 };

describe("parseTickers", () => {
  it("takes the mid of bid and ask", () => {
    const parsed = parseTickers(TICKERS, 1000);
    expect(parsed.perUsd.ARS).toBe(1605495n * 10n ** 15n); // 1605.495
    expect(parsed.perUsd.BRL).toBe(503655n * 10n ** 13n); // 5.03655
    expect(parsed.fetchedAt).toBe(1000);
  });

  it("falls back to the one live side, then to the last price", () => {
    const oneSided = [
      { ...TICKERS[0], bid: "0", ask: "1606" },
      { ...TICKERS[1], bid: "0", ask: "0", last_price: "5.04" },
    ];
    const parsed = parseTickers(oneSided, 0);
    expect(parsed.perUsd.ARS).toBe(1606n * E18);
    expect(parsed.perUsd.BRL).toBe(504n * 10n ** 16n);
  });

  it("refuses a pair with no usable price at all", () => {
    const dead = [{ ...TICKERS[0], bid: "0", ask: "0", last_price: "0" }, TICKERS[1]];
    expect(() => parseTickers(dead, 0)).toThrow(RatesUnavailableError);
  });

  it("refuses a missing pair or a malformed payload", () => {
    expect(() => parseTickers([TICKERS[0]], 0)).toThrow(/USDT_WBRL/);
    expect(() => parseTickers({ error: "maintenance" }, 0)).toThrow(RatesUnavailableError);
    expect(() => parseTickers([{ ...TICKERS[0], bid: "abc" }, TICKERS[1]], 0)).toThrow(RatesUnavailableError);
  });
});

describe("fetchReferenceRates", () => {
  it("reads /tickers from the configured base URL", async () => {
    const fetchImpl = vi.fn(async () => Response.json(TICKERS));
    const parsed = await fetchReferenceRates({ baseUrl: "https://textile.test", fetchImpl, now: () => 5 });
    expect(fetchImpl).toHaveBeenCalledWith("https://textile.test/tickers", expect.anything());
    expect(parsed.perUsd.ARS).toBe(1605495n * 10n ** 15n);
  });

  it("turns HTTP errors into RatesUnavailableError", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(fetchReferenceRates({ baseUrl: "https://textile.test", fetchImpl })).rejects.toThrow(RatesUnavailableError);
  });
});

describe("createRatesCache", () => {
  it("serves from cache within the TTL", async () => {
    let clock = 0;
    const load = vi.fn(async () => ({ ...rates, fetchedAt: clock }));
    const get = createRatesCache(load, { ttlMs: 60_000, now: () => clock });
    await get();
    clock = 59_000;
    await get();
    expect(load).toHaveBeenCalledTimes(1);
    clock = 61_000;
    await get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps serving a recent value through an outage, then gives up", async () => {
    let clock = 0;
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new RatesUnavailableError("down");
      return { ...rates, fetchedAt: clock };
    });
    const get = createRatesCache(load, { ttlMs: 60_000, maxStaleMs: 600_000, now: () => clock });
    await get();
    fail = true;
    clock = 300_000;
    await expect(get()).resolves.toMatchObject({ fetchedAt: 0 });
    clock = 601_000;
    await expect(get()).rejects.toThrow(RatesUnavailableError);
  });
});

describe("convert", () => {
  it("needs no rates for dollars", () => {
    expect(fiatPerUsd(null, "USD")).toBe(E18);
    expect(() => fiatPerUsd(null, "ARS")).toThrow(RatesUnavailableError);
  });

  it("converts through USD and rounds half up to cents", () => {
    expect(convertFiat("300.00", "USD", "ARS", rates)).toBe("481648.50");
    expect(convertFiat("482000.00", "ARS", "USD", rates)).toBe("300.22");
    expect(convertFiat("1500.50", "BRL", "USD", rates)).toBe("297.92");
    expect(convertFiat("10.00", "ARS", "ARS", null)).toBe("10.00");
  });
});
