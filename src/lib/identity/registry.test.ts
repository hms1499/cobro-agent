import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { IDENTITY_REGISTRY, extractRegisteredAgentId, identityRegistryAbi } from "./registry";

function registeredLog(address: string, agentId: bigint): Log {
  const topics = encodeEventTopics({
    abi: identityRegistryAbi,
    eventName: "Registered",
    args: { agentId, owner: "0x64ad61211c1b0b7f20b3e04b49661f30f152ae78" },
  });
  return {
    address,
    topics,
    data: encodeAbiParameters([{ type: "string" }], ["https://cobro-agent.vercel.app/agent-card.json"]),
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  } as unknown as Log;
}

describe("extractRegisteredAgentId", () => {
  it("reads agentId from the registry's Registered event", () => {
    expect(extractRegisteredAgentId([registeredLog(IDENTITY_REGISTRY, 9752n)])).toBe(9752n);
  });

  it("ignores the same event emitted by another contract", () => {
    expect(extractRegisteredAgentId([registeredLog("0x000000000000000000000000000000000000dEaD", 1n)])).toBeNull();
  });

  it("returns null when there is no Registered event", () => {
    expect(extractRegisteredAgentId([])).toBeNull();
  });
});
