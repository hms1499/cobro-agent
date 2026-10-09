/** CAIP-2 id of Celo mainnet, as x402 names networks. Safe to import from browser code. */
export const CELO_NETWORK = "eip155:42220" as const;

/** How long a signed authorization stays valid for settlement (its on-chain validity window). */
export const PAYMENT_TIMEOUT_SECONDS = 300;
