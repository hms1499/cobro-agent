import { TOKENS } from "@/lib/chain/tokens";
import { getDb } from "@/lib/db/client";
import { invoicePaymentDeps } from "@/lib/payments/deps";
import { preparePayment, type QuoteResponse } from "@/lib/payments/pay-flow";

export async function GET(request: Request, ctx: RouteContext<"/api/pay/[slug]/quote">) {
  const { slug } = await ctx.params;
  const prepared = await preparePayment(invoicePaymentDeps(getDb()), {
    slug,
    asset: new URL(request.url).searchParams.get("asset"),
  });
  if (!prepared.ok) return Response.json(prepared.response.body, { status: prepared.response.status });
  const { asset, quote, invoice } = prepared;
  const body: QuoteResponse = {
    asset,
    amountAtomic: quote.amountAtomic.toString(),
    expiresAt: quote.expiresAt.toISOString(),
    payTo: invoice.payTo,
    tokenAddress: TOKENS[asset].address,
    decimals: TOKENS[asset].decimals,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
