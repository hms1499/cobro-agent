import { getDb } from "@/lib/db/client";
import { invoicePaymentDeps } from "@/lib/payments/deps";
import { runPayFlow } from "@/lib/payments/pay-flow";
import { getResourceServer, processX402 } from "@/lib/payments/x402-server";

export async function GET(request: Request, ctx: RouteContext<"/api/pay/[slug]">) {
  const { slug } = await ctx.params;
  let server: Awaited<ReturnType<typeof getResourceServer>>;
  try {
    server = await getResourceServer();
  } catch (error) {
    console.error("x402 facilitator unavailable:", error instanceof Error ? error.message : error);
    return Response.json({ error: "facilitator_unavailable" }, { status: 503 });
  }
  const response = await runPayFlow(
    { ...invoicePaymentDeps(getDb()), process: (route) => processX402(server, route, request) },
    { slug, asset: new URL(request.url).searchParams.get("asset") },
  );
  return Response.json(response.body, { status: response.status, headers: response.headers });
}
