import type { RouteConfig } from "@x402/core/server";
import type { Address } from "viem";
import { RatesUnavailableError } from "@/lib/fx/rates";
import type { PublicInvoice } from "@/lib/invoices/repo";
import { isPayAsset, type PayAsset } from "@/lib/money/currencies";
import type { LockedQuote } from "./quotes-repo";
import { buildInvoiceRoute, type X402Exchange } from "./x402-server";

export interface PayResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** What the payment page needs before it asks the wallet to sign. */
export interface QuoteResponse {
  asset: PayAsset;
  amountAtomic: string;
  expiresAt: string;
  payTo: Address;
  tokenAddress: Address;
  decimals: number;
}

export interface PayFlowDeps {
  now(): Date;
  findInvoice(slug: string): Promise<PublicInvoice | null>;
  quote(invoice: PublicInvoice, asset: PayAsset): Promise<LockedQuote>;
  process(route: RouteConfig): Promise<X402Exchange>;
  claim(invoiceId: string): Promise<boolean>;
  release(invoiceId: string): Promise<void>;
  record(payment: { invoiceId: string; payer: string; asset: PayAsset; amountAtomic: bigint; txHash: string }): Promise<void>;
}

type Prepared =
  | { ok: true; invoice: PublicInvoice & { payTo: Address }; asset: PayAsset; quote: LockedQuote }
  | { ok: false; response: PayResponse };

const reply = (status: number, body: unknown): PayResponse => ({ status, headers: {}, body });
const fail = (status: number, body: unknown): Prepared => ({ ok: false, response: reply(status, body) });

/** Shared by the quote endpoint and the payment endpoint, so both refuse the same invoices. */
export async function preparePayment(
  deps: Pick<PayFlowDeps, "now" | "findInvoice" | "quote">,
  input: { slug: string; asset: string | null },
): Promise<Prepared> {
  const asset = input.asset;
  if (!isPayAsset(asset)) return fail(400, { error: "bad_asset" });
  const invoice = await deps.findInvoice(input.slug);
  if (!invoice) return fail(404, { error: "not_found" });
  if (invoice.status === "paid" || invoice.status === "cancelled") return fail(409, { error: "closed", status: invoice.status });
  if (invoice.status === "settling" && invoice.settlingUntil && invoice.settlingUntil > deps.now()) {
    return fail(409, { error: "busy" });
  }
  const payTo = invoice.payTo;
  if (!payTo) return fail(503, { error: "not_ready" });
  try {
    const quote = await deps.quote(invoice, asset);
    return { ok: true, invoice: { ...invoice, payTo }, asset, quote };
  } catch (error) {
    if (error instanceof RatesUnavailableError) return fail(503, { error: "rates_unavailable" });
    throw error;
  }
}

/**
 * Spec §7.3 and §12: 402 → (client signs) → verify → claim → settle → record.
 * An invoice that cannot be claimed is never settled; a failed settlement reopens it; an unknown
 * outcome keeps the hold until it expires, so nobody is invited to pay twice.
 */
export async function runPayFlow(deps: PayFlowDeps, input: { slug: string; asset: string | null }): Promise<PayResponse> {
  const prepared = await preparePayment(deps, input);
  if (!prepared.ok) return prepared.response;
  const { invoice, asset, quote } = prepared;

  const { result, settle } = await deps.process(
    buildInvoiceRoute({ asset, amountAtomic: quote.amountAtomic, payTo: invoice.payTo, description: `Cobro invoice ${invoice.slug}` }),
  );
  if (result.type === "payment-error") {
    return { status: result.response.status, headers: result.response.headers, body: result.response.body ?? {} };
  }
  if (result.type !== "payment-verified") return reply(500, { error: "unexpected_x402_state" });

  if (!(await deps.claim(invoice.id))) return reply(409, { error: "busy" });

  const settled = await settle();
  if (settled.kind === "unknown") {
    // The transfer may already be on its way: keep the hold so nobody is invited to pay twice.
    console.error(`Settlement outcome unknown for invoice ${invoice.slug}: ${settled.reason}`);
    return reply(502, { error: "settlement_unknown" });
  }
  if (settled.kind === "failed") {
    await deps.release(invoice.id);
    return settled.response;
  }

  const payment = {
    invoiceId: invoice.id,
    payer: settled.payer ?? "",
    asset,
    amountAtomic: BigInt(result.paymentRequirements.amount),
    txHash: settled.transaction,
  };
  try {
    await deps.record(payment);
  } catch {
    try {
      await deps.record(payment);
    } catch (error) {
      // The money has moved; the payer must see success. Reconcile from this log line.
      console.error(`PAYMENT SETTLED BUT NOT RECORDED: invoice ${invoice.slug} tx ${settled.transaction}`, error);
    }
  }
  return { status: 200, headers: settled.headers, body: { status: "paid", txHash: settled.transaction } };
}
