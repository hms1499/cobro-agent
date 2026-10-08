import { isAddressEqual, parseEventLogs, type Log } from "viem";

export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
export const AGENT_REGISTRY_ID = `eip155:42220:${IDENTITY_REGISTRY}` as const;

/** Only the overload and event Cobro uses (full ABI: erc-8004/erc-8004-contracts abis/IdentityRegistry.json). */
export const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Registered",
    anonymous: false,
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

export function extractRegisteredAgentId(logs: readonly Log[]): bigint | null {
  const events = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: [...logs] });
  const event = events.find((candidate) => isAddressEqual(candidate.address, IDENTITY_REGISTRY));
  return event ? event.args.agentId : null;
}
