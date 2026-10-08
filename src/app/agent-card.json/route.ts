import { readPublicEnv } from "@/lib/config/public";
import { buildAgentCard } from "@/lib/identity/agent-card";

export function GET() {
  const env = readPublicEnv();
  const card = buildAgentCard({ appUrl: env.NEXT_PUBLIC_APP_URL, agentId: env.NEXT_PUBLIC_AGENT_ID });
  return Response.json(card, { headers: { "Access-Control-Allow-Origin": "*" } });
}
