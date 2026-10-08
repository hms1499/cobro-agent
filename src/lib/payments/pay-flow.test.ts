import type { HTTPProcessResult, ProcessSettleResultResponse } from "@x402/core/server";
import { describe, expect, it, vi } from "vitest";
import { RatesUnavailableError } from "@/lib/fx/rates";
import type { PublicInvoice } from "@/lib/invoices/repo";
import { runPayFlow, type PayFlowDeps } from "./pay-flow";

const NOW = new Date("2026-10-15T12:00:00Z");
const TX = `0x${"ab".repeat(32)}`;
const invoice: PublicInvoice = {
  id: "inv-1",
  slug: "abc",
  clientName: "Acme",
  description: "Logo",
  amount: "300.00",
  currency: "USD",
  dueDate: null,
  status: "open",
  settlingUntil: null,
  freelancerName: "Ana",
  payTo: "0x1111111111111111111111111111111111111111",
  recurringSlug: null,
};
const verified = {
  type: "payment-verified",
  paymentPayload: {},
  paymentRequirements: { amount: "300000000" },
} as unknown as HTTPProcessResult;
const unpaid = {
  type: "payment-error",
  response: { status: 402, headers: { "PAYMENT-REQUIRED": "e30=" }, body: {} },
} as unknown as HTTPProcessResult;
const settledOk = { success: true, transaction: TX, payer: "0x9999", headers: { "PAYMENT-RESPONSE": "x" } } as unknown as ProcessSettleResultResponse;
const settledFail = {
  success: false,
  errorReason: "insufficient_funds",
  headers: {},
  response: { status: 402, headers: { "PAYMENT-REQUIRED": "e30=" }, body: {} },
} as unknown as ProcessSettleResultResponse;

function deps(overrides: Partial<PayFlowDeps> & { result?: HTTPProcessResult; settle?: () => Promise<ProcessSettleResultResponse> } = {}) {
  const { result = verified, settle = async () => settledOk, ...rest } = overrides;
  const base = {
    now: () => NOW,
    findInvoice: vi.fn(async () => invoice),
    quote: vi.fn(async () => ({ asset: "USDT" as const, amountAtomic: 300_000000n, rate: "1", expiresAt: new Date("2026-10-15T12:10:00Z") })),
    process: vi.fn<PayFlowDeps["process"]>(async () => ({ result, settle: vi.fn(settle) })),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
  };
  return { ...base, ...rest } as typeof base & PayFlowDeps;
}

const run = (d: PayFlowDeps, asset: string | null = "USDT") => runPayFlow(d, { slug: "abc", asset });

describe("runPayFlow: before payment", () => {
  it("rejects unknown assets and invoices", async () => {
    expect(await run(deps(), "USDC")).toMatchObject({ status: 400, body: { error: "bad_asset" } });
    expect(await run(deps({ findInvoice: async () => null }))).toMatchObject({ status: 404 });
  });

  it("refuses paid, cancelled and currently-settling invoices", async () => {
    const paid = deps({ findInvoice: async () => ({ ...invoice, status: "paid" }) });
    expect(await run(paid)).toMatchObject({ status: 409, body: { error: "closed", status: "paid" } });
    const settling = deps({
      findInvoice: async () => ({ ...invoice, status: "settling", settlingUntil: new Date("2026-10-15T12:02:00Z") }),
    });
    expect(await run(settling)).toMatchObject({ status: 409, body: { error: "busy" } });
  });

  it("treats an expired settling hold as open", async () => {
    const stale = deps({
      findInvoice: async () => ({ ...invoice, status: "settling", settlingUntil: new Date("2026-10-15T11:59:00Z") }),
      result: unpaid,
    });
    expect((await run(stale)).status).toBe(402);
  });

  it("explains a missing wallet or missing rates", async () => {
    expect(await run(deps({ findInvoice: async () => ({ ...invoice, payTo: null }) }))).toMatchObject({
      status: 503,
      body: { error: "not_ready" },
    });
    const noRates = deps({
      quote: async () => {
        throw new RatesUnavailableError("down");
      },
    });
    expect(await run(noRates)).toMatchObject({ status: 503, body: { error: "rates_unavailable" } });
  });

  it("answers an unpaid request with the 402 and claims nothing", async () => {
    const d = deps({ result: unpaid });
    expect(await run(d)).toEqual({ status: 402, headers: { "PAYMENT-REQUIRED": "e30=" }, body: {} });
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("prices the route from the locked quote and the owner's treasury wallet", async () => {
    const d = deps({ result: unpaid });
    await run(d);
    expect(d.process.mock.calls[0][0].accepts).toMatchObject({
      payTo: invoice.payTo,
      price: { amount: "300000000" },
    });
  });
});

describe("runPayFlow: with a verified payment", () => {
  it("claims, settles, records and returns the transaction", async () => {
    const d = deps();
    expect(await run(d)).toEqual({ status: 200, headers: { "PAYMENT-RESPONSE": "x" }, body: { status: "paid", txHash: TX } });
    expect(d.claim).toHaveBeenCalledWith("inv-1");
    expect(d.record).toHaveBeenCalledWith({ invoiceId: "inv-1", payer: "0x9999", asset: "USDT", amountAtomic: 300_000000n, txHash: TX });
  });

  it("never settles when another payment holds the invoice", async () => {
    const settle = vi.fn(async () => settledOk);
    const d = deps({ claim: async () => false, settle });
    expect(await run(d)).toMatchObject({ status: 409, body: { error: "busy" } });
    expect(settle).not.toHaveBeenCalled();
  });

  it("reopens the invoice when settlement fails", async () => {
    const d = deps({ settle: async () => settledFail });
    expect((await run(d)).status).toBe(402);
    expect(d.release).toHaveBeenCalledWith("inv-1");
    expect(d.record).not.toHaveBeenCalled();
  });

  it("keeps the hold when the settlement outcome is unknown", async () => {
    const d = deps({
      settle: async () => {
        throw new Error("timeout");
      },
    });
    expect(await run(d)).toMatchObject({ status: 502, body: { error: "settlement_unknown" } });
    expect(d.release).not.toHaveBeenCalled();
  });

  it("retries recording once and still reports the payment", async () => {
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error("db blip"))
      .mockResolvedValueOnce(undefined);
    const d = deps({ record });
    expect((await run(d)).status).toBe(200);
    expect(record).toHaveBeenCalledTimes(2);
  });
});
