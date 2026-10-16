# Mainnet treasury smoke tests

Dates: 2026-10-13 to 2026-10-14 · Checked: 2026-10-16 · App: https://cobro-agent.vercel.app · Para environment: BETA
Treasury: `0x3C9b8b64372A3dD0313358ddd4b56D2B66Ff1a97` (smoke-A account, rules: reserve 3,000 ARS, defaults otherwise)

| Smoke | Date (UTC) | What was done | Transactions | Tag | Result |
|---|---|---|---|---|---|
| Dry run | 2026-10-13 13:56 → 2026-10-14 04:39 | Production with `TREASURY_ENABLED=true`, `TREASURY_DRY_RUN=true`. The user paid a US$1.10 invoice (`/pay/u6JurKHHAd`) in USD₮; the payment's `after()` ran the agent. | Payment [0x64a61b1a…5fce](https://celoscan.io/tx/0x64a61b1abedf96f0e63b263ed9b2ed9b15d82a208290c9fdae04e7bdc5b95fce) (facilitator) | n/a (facilitator) | PASS. `dry_run` event 1.4 s after settlement: 1.067554 USD₮ → wARS, reason `top_up`, US$1.06. No transaction signed. |
| E, withdrawal | 2026-10-14 04:21 | On `/app/withdraw` the user sent 0.98 USD₮ to their Cobro wallet `0xd1d06b5c56b6B0b769340588Fc31fE76b6423B66`. | [0xb262c19d…0a67](https://celoscan.io/tx/0xb262c19d0692efd76064c23c4336733b546eeddc86377f38219a1a6ecf610a67) | present | PASS. Sent by the treasury (nonce 0), 0.98 USD₮ to the personal wallet, gas 0.002446 USD₮ (CIP-64), low-s. Feed: `withdrawn`. The wARS half of the smoke was not run (see notes). |
| D, first autonomous swap | 2026-10-14 05:42 | After going live (`TREASURY_DRY_RUN=false`, deployment `cobro-agent-wd9iyn39e`, 04:39), the scheduled GitHub cron run [38518075871](https://github.com/hms1499/cobro-agent/actions/runs/38518075871) ran the agent unattended. | Approve [0x9179e027…72f0](https://celoscan.io/tx/0x9179e027510046b64e57b513bcc0099a943fb80b175330aaa9ebc3488d4972f0), swap [0xf3a8852e…b00c](https://celoscan.io/tx/0xf3a8852e9ca48432b59c981c10f1fb7321d1d595ff81e6d5c79f5c965521b00c) | present on both | PASS. See below. |

## Smoke D in detail

- Cron output: `{"issued":0,"reconciled":{"recorded":0,"reopened":0,"errors":0},"pending":{"settled":0,"stillPending":0,"errors":0},"treasury":{"converted":1}}`.
- Intent `top_up` USD₮ → wARS, 1.067554 USD₮, filled on the first attempt. RFQ `rfq_XOQkS9bdluToYGKi`; slippage **2 bps** against the Textile mid (limit 50).
- Approve (block 80055802): 200 USD₮ allowance (the daily cap) to the reactor `0xa9AA…35b3`, which was `quote.spender`. Gas 0.002452 USD₮.
- Swap (block 80055805): 1.067448 USD₮ to the maker `0xf0d9…8639` plus 0.000106 USD₮ Textile fee to `0x5172…cba4`; **1,718.483 wARS** back to the treasury, about 1,610 ARS per USD₮. Gas 0.004930 USD₮.
- Both transactions: status success, sent by the treasury (nonces 1 and 2), CIP-64 gas in USD₮, low-s signatures, attribution tag `celo_bc3965e128ba` (`scripts/verify-tx.ts`).
- Database: `fx_trades` row `filled`, `treasury_txs` approve and swap `success`, events `converted`; no wallet lock left.
- Textile accepted the Para-signed `takerProof`. This is one sample, so the high-s risk (Para `sign-typed-data` is not low-s normalised) is not ruled out.
- Treasury after the swap: 0.042618 USD₮ and 1,718.48 wARS. The reserve (3,000 ARS) is still short, but the remaining dollars are below the $1 minimum, so the agent waits.

## Notes

- **Dry run lasted about 15 hours, not a full day.** The GitHub schedule ran the cron only three times in that window, and with 1 USD₮ minus the 0.05 gas reserve below the $1 minimum, the decision path was never exercised. The user ruled on 2026-10-14 to replace the rest of the day with a paid invoice in dry run (row 1), then go live.
- **The GitHub schedule (`*/10 * * * *`) actually runs every 2 to 5 hours** (seven runs on 2026-10-15). The payment-triggered `after()` covers the moment money arrives; an external cron is an open option.
- **Order differed from the plan.** The withdrawal (Smoke E) ran before the swap and before going live, on 0.98 USD₮ of the user's own funds. The wARS from Smoke D (1,718.48) stays in the treasury as the spending reserve; a wARS withdrawal is still to be tried.
- The feed text for Smoke D ("Converted…", "Why?", Celoscan link) was not checked on screen during this check; only the stored event was.
- No gas drip was needed: every transaction paid gas from the treasury's own USD₮ (`gas_dripped_at` is null for both production wallets). The operator drip path is still unexercised on mainnet.
- Operator: the user's EOA `0x2B33cb68c4D826a4Fc36264bcDB46081c99f4f57` since 2026-10-13 (spec §8.7). Balance on 2026-10-16: 1.512799 USDC, 0.085497 USD₮, 2.8187 CELO.
