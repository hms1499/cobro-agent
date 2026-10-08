import { AGENT_REGISTRY_ID } from "./registry";

export interface AgentCard {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string }[];
  x402Support: boolean;
  active: boolean;
  registrations: { agentId: number; agentRegistry: string }[];
}

export function agentCardUrl(appUrl: string): string {
  return `${appUrl}/agent-card.json`;
}

export function buildAgentCard(input: { appUrl: string; agentId?: number }): AgentCard {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Cobro",
    description:
      "Invoicing and treasury agent for Latin American freelancers. Clients pay invoices in USA₮, USD₮, wARS or wBRL over x402 on Celo; the agent keeps a local-currency spending reserve and moves the rest into dollars through Textile FX, within limits the freelancer sets.",
    image: `${input.appUrl}/cobro-mark.svg`,
    services: [{ name: "web", endpoint: input.appUrl }],
    x402Support: true,
    active: true,
    registrations:
      input.agentId === undefined ? [] : [{ agentId: input.agentId, agentRegistry: AGENT_REGISTRY_ID }],
  };
}
