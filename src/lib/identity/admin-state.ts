export const CELO_CHAIN_ID = 42220;

export type RegistrationBlocker = "already-registered" | "not-connected" | "wrong-wallet" | "wrong-network" | "pending";

export function registrationBlocker(input: {
  connectedAddress?: string;
  chainId?: number;
  agentWallet: string;
  registeredAgentId?: number | bigint;
  isPending: boolean;
}): RegistrationBlocker | null {
  if (input.registeredAgentId !== undefined) return "already-registered";
  if (!input.connectedAddress) return "not-connected";
  if (input.connectedAddress.toLowerCase() !== input.agentWallet.toLowerCase()) return "wrong-wallet";
  if (input.chainId !== CELO_CHAIN_ID) return "wrong-network";
  if (input.isPending) return "pending";
  return null;
}
