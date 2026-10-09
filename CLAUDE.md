# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Cobro: an invoicing and treasury agent for LatAm freelancers, built for the Celo "Agents on Open Rails" hackathon. Next.js 16.4 (App Router) on Vercel, Neon Postgres via Drizzle, Para wallets, x402 payments on Celo mainnet.

- Spec (binding): `docs/superpowers/specs/2026-10-08-cobro-design.md`. Plans: `docs/superpowers/plans/`. Visual rules: `design-system/cobro/MASTER.md`.
- Plan progress, rulings and deferred findings live in `.superpowers/sdd/<plan>/progress.md` (gitignored). Read it before resuming a plan.

## Commands

- Full gate before claiming done: `npm test && npm run typecheck && npm run lint && npm run build`
- `npm run typecheck` runs `next typegen` first (route types such as `PageProps<"/r/[slug]">`).
- One area: `npx vitest run src/lib/money`. Tests are colocated `*.test.ts` under `src/` and `scripts/`.
- Migrations: `npm run db:generate`, then `npm run db:migrate`. The migrate script reads `.env.local`, which points at the Neon **dev** branch. Production (Vercel) uses the Neon **main** branch, so a new migration must also be applied there.
- Scripts run with `npx tsx --env-file=.env.local scripts/<name>.ts`. Use `.mts` (or wrap in an async IIFE) for top-level await.

## Rules that are easy to get wrong

- `cacheComponents: true`: any component that reads `cookies()`, `params`, `searchParams` or the database sits inside `<Suspense>` and awaits the request value before touching the DB. `redirect()`/`notFound()` inside Suspense stream as HTTP 200 with a client redirect.
- Money: token amounts are `bigint` in code and base-10 strings in the DB and JSON, never floats. Every fiat amount on screen goes through `formatMoney` or `displayAmount`. Form amounts go through `parseFiatInput`.
- Tokens and EIP-712 domains come only from `TOKENS` in `src/lib/chain/tokens.ts`. Pay assets are USAT, USDT, WARS, WBRL. USDC is excluded on purpose (Textile cannot convert it).
- Celo mainnet only (chain 42220, x402 network `eip155:42220`). x402 prices are explicit `{ asset, amount, extra }` objects.
- Any transaction we send goes through `createOperatorClient` (`src/lib/chain/clients.ts`), which appends our attribution tag `celo_bc3965e128ba`. The tag is issued by Loops; never derive it.
- All user-facing text goes through `t()` from `@/i18n` with keys in `src/i18n/en.ts`.
- UI follows `MASTER.md`: tokens only (no raw hex), Lucide icons with `aria-hidden`, touch targets `min-h-11`, one primary button per screen, `role="alert"`/`aria-live` for errors and status. Token units, gas and addresses stay behind a "Details" disclosure.
- `src/app/layout.tsx` imports `@getpara/react-sdk/styles.css` **before** `globals.css`. Para's CSS carries its own Tailwind preflight in the same layers; reversing the order breaks our font and border colours.
- Para runs in BETA for the hackathon (one key pair for localhost and production). Treasury wallets cannot move between Para environments.

## Testing

- Unit tests never touch the network: inject `fetch`.
- DB tests use `createTestDb()` from `src/lib/db/testing.ts` (in-memory PGlite with the real migrations). PGlite is single-connection, so concurrency tests there do not prove real races.

## Secrets and money

- Secrets live in `.env.local`, Vercel env and GitHub Actions secrets. Never print, log or commit a value. To check env, print names, lengths or host prefixes only. Push values to Vercel or GitHub through stdin (`vercel env add NAME production`, `gh secret set NAME`), never as arguments.
- Never ask for a user's private key or seed phrase. For payer tests, generate a throwaway key in the session scratchpad and delete it afterwards.
- Ask before any destructive DB operation (truncate, delete, schema reset) or any mainnet transaction, even on the dev branch.

## Git

- One branch per plan (`plan-N-<topic>`). When it is done, merge `--no-ff` into `main` locally, run the full gate on the merge, then push. `main` deploys to production on Vercel.
- Commit messages: `feat(scope): …`, `fix(scope): …`, `docs: …`, `chore: …`, ending with the `Co-Authored-By` trailer.
- The repo-local git author is `hms1499 <thanvanhuy159@gmail.com>`; the global config differs, so do not override it.
