# Mainnet payment smoke tests

Date: 2026-10-09 · App: https://cobro-agent.vercel.app · Para environment: BETA · Facilitator signer: 0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48

| Smoke | Invoice | Paid with | Amount | Settlement tx | Result |
|---|---|---|---|---|---|
| A | 1.00 USD (`/pay/3JbHy69CHA`) | USD₮ (planned USA₮) | 1.00 USD₮ | [0x1658f0c1…e2ca](https://celoscan.io/tx/0x1658f0c1b73d71c5a98d1372cc27cbd1883e6db0b0d80a7cf4673fc7c4d1e2ca) | PASS. Sent by the facilitator; 1 USD₮ from the payer to the freelancer's treasury. The page and `/api/pay` (every asset) then report the invoice paid. |
| B | 1,000 ARS | wARS (Permit2 + EIP-2612) | — | — | NOT RUN. The payer wallet holds no wARS. |
| C | 1.00 USD weekly (`/r/ddSP2SJdfQ` → `/pay/E8TTwdPk9E`) | USD₮ | 1.00 USD₮ | [0x4b0d22fd…2f68](https://celoscan.io/tx/0x4b0d22fd466646f96824f3b62767504d2087d5c0f58632c7788af9b57df52f68) | PASS. Two payments signed 150 ms apart and sent at once from one wallet: one settled (200), the other got `409 {"error":"busy"}` before anything was settled; the wallet lost exactly 1 USD₮. `/r/` then shows "Every invoice so far is paid" with the period. |

Notes:
- Smoke A used USD₮ because the payer wallet held no USA₮ (only USDC, which Cobro does not accept, see §5). Repeat with USA₮ once Plan 3 can swap.
- Smoke C was driven by a script from a throwaway wallet (`createInvoicePayerFetch` with a local key) instead of two browser tabs, so the second tab's on-screen message was not observed.
- Settlement transactions are sent by Celo's facilitator and carry no attribution tag (spec §15 question 1).
- On the user's request the Smoke A dollar was returned from the treasury with EIP-3009 `transferWithAuthorization`: the treasury signed through Para `sign-typed-data`, the operator submitted it with gas paid in USDC (CIP-64) and our tag: [0xaecd331b…5fa0](https://celoscan.io/tx/0xaecd331b63c7fa670c9770f484f1b2cbf38c92e524be4db89944f850ada25fa0). This is Cobro's first tagged mainnet transaction from a treasury flow and a preview of Plan 3's withdrawal path.
- Fixes found while preparing these runs: Para modal stylesheet never imported (`f214af5`), sign-in retry loop (`28c1a27`). Vercel had no `DATABASE_URL`; it was added by hand (no Neon integration).
