import { describe, expect, it } from "vitest";
import { agentCardUrl, buildAgentCard } from "./agent-card";

const appUrl = "https://cobro-agent.vercel.app";

describe("buildAgentCard", () => {
  it("follows the ERC-8004 registration-v1 shape", () => {
    const card = buildAgentCard({ appUrl });
    expect(card.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(card.name).toBe("Cobro");
    expect(card.image).toBe(`${appUrl}/cobro-mark.svg`);
    expect(card.services).toEqual([{ name: "web", endpoint: appUrl }]);
    expect(card.x402Support).toBe(true);
    expect(card.active).toBe(true);
  });

  it("has no registrations until the agent id is known", () => {
    expect(buildAgentCard({ appUrl }).registrations).toEqual([]);
  });

  it("lists the Celo registration once the agent id is set", () => {
    expect(buildAgentCard({ appUrl, agentId: 9752 }).registrations).toEqual([
      { agentId: 9752, agentRegistry: "eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" },
    ]);
  });
});

describe("agentCardUrl", () => {
  it("points at the route served by the app", () => {
    expect(agentCardUrl(appUrl)).toBe(`${appUrl}/agent-card.json`);
  });
});
