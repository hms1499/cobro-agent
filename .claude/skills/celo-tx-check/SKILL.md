---
name: celo-tx-check
description: Verify a Celo mainnet transaction — status, sender, ERC-20 transfers with readable amounts, and whether it carries Cobro's attribution tag. Use when the user shares a celoscan link or tx hash, or after any payment, refund or tagged transaction.
---

Check the transaction `$ARGUMENTS` (a `0x…` hash or a celoscan.io/tx/ link).

1. **Read the transaction and receipt** from `https://forno.celo.org` with `eth_getTransactionByHash` and `eth_getTransactionReceipt`, using `node -e` and `fetch`. No secrets are needed.
2. **Report:**
   - The status and block number.
   - The sender (`from`) and the contract called (`to`). Name the sender when it is known: `0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48` is Celo's x402 facilitator, and the operator address comes from `OPERATOR_PRIVATE_KEY`; derive it, never print the key.
   - Every `Transfer` log (topic `0xddf252ad…`) as token → from → to → amount. Use the decimals from `TOKENS` in `src/lib/chain/tokens.ts`: USD₮, USA₮ and USDC have 6, wARS and wBRL have 18.
   - The CIP-64 fee transfers (gas paid in a stablecoin go to/from `0x0000…` and the fee handler). List them separately as gas.
3. **Attribution:** run `npx tsx scripts/verify-tx.ts <hash>`. Our code is `celo_bc3965e128ba`. Settlement transactions sent by the x402 facilitator are expected to carry no tag (spec §15, question 1).
4. **Balances:** if the user asks whether funds arrived, read `balanceOf` for the relevant addresses. Pad the address to 32 bytes after stripping only the `0x`.
5. **Summarise** in a small table: what moved, from whom, to whom, who paid gas, and whether the tag is present.
