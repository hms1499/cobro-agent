# Plan 1: Foundation and Agent Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Cobro Next.js app with Celo plumbing that tags every transaction, register Cobro's ERC-8004 identity from the agent wallet (the entry's first tagged mainnet transaction), fund a tagged operator wallet that pays gas in a stablecoin, and run the Para feasibility spike that decides the treasury signer.

**Architecture:** One Next.js 16.4 App Router app (TypeScript, Tailwind 4, shadcn/ui) deployed on Vercel. Small focused modules under `src/lib/` (`chain/`, `config/`, `identity/`, `signer/`, `auth/`, `wallet/`) hold all logic as plain functions with colocated Vitest tests; pages and route handlers stay thin. Mainnet steps that need a human signature run through an owner-only admin page (`/admin/agent`) or `tsx` scripts.

**Tech Stack:** Node.js 24, Next.js 16.4.0, React 19.3, Tailwind CSS 4, shadcn 4.21.4 (Radix base), viem 2.57.3, wagmi 3.7.7, @tanstack/react-query 5.104.1, zod 4.6.5, @celo/attribution-tags 0.5.0, jose 6.2.12, @getpara/react-sdk 3.21.0, Vitest 5.0.3, tsx 4.23.15.

**Spec:** `docs/superpowers/specs/2026-10-08-cobro-design.md` (this plan covers milestone week 1 in §14, plus the Para spike in §13). Visual rules: `design-system/cobro/MASTER.md`.

This is plan 1 of 4. Plans 2–4 (payments, treasury, agent chat and polish) are written after Task 11, because they depend on the signer decision recorded there. The database (Neon Postgres + Drizzle), listed under week 1 in the spec, moves to Plan 2 with its first table: nothing in this plan stores data.

## Global Constraints

- Celo mainnet only: chain id `42220`, RPC `https://forno.celo.org`, explorer `https://celoscan.io`.
- Attribution tag `celo_bc3965e128ba` (issued by Loops House). Every transaction the app or a script broadcasts carries it in calldata. Its data suffix is exactly `0x63656c6f5f626333393635653132386261110080218021802180218021802180218021`.
- Agent wallet `0x64ad61211c1b0b7f20b3e04b49661f30f152ae78` (the user's EOA). Its private key never enters the repo, env files, the server or the terminal. It signs only in the user's browser wallet.
- Its existing ERC-8004 identity #9751 "CoinOp" stays untouched. Cobro registers a new identity with `register(string agentURI)` on `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.
- Secrets (`OPERATOR_PRIVATE_KEY`, `PARA_API_KEY`) live only in `.env.local` (gitignored) and Vercel env. Never print, log or commit them.
- Public env names: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ATTRIBUTION_CODE`, `NEXT_PUBLIC_AGENT_WALLET`, `NEXT_PUBLIC_AGENT_ID`. These are the spec's `ATTRIBUTION_CODE` and `AGENT_WALLET` with the `NEXT_PUBLIC_` prefix, because the admin page needs them in the browser.
- Next.js inlines `NEXT_PUBLIC_*` only where each variable is written out literally as `process.env.NEXT_PUBLIC_X`.
- Next.js 16.4 differs from older versions and ships with `cacheComponents: true`. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (the scaffold's `AGENTS.md` says the same).
- Exact dependency versions as listed in Tech Stack. Install with `npm install <pkg>@<version>`.
- All user-facing text goes through `t()` from `src/i18n` with keys in `src/i18n/en.ts` (English first).
- UI follows `design-system/cobro/MASTER.md`. Use the `ui-ux-pro-max` skill for UI decisions. Colors come from tokens only, with no raw hex in components.
- Token amounts are `bigint` or base-10 strings, never floats.
- Tests are Vitest files colocated as `*.test.ts`. Run all of them with `npm test`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A public env var missing or mistyped on Vercel (for example `NEXT_PUBLIC_ATTRIBUTION_CODE=celo_bc3965e128b`) must fail the build with the variable named. It must never deploy an agent card with a wrong URL or tag. Pinned in Task 3.
2. Admin page with the wallet on another network: registration must be blocked behind "Switch to Celo", never sent to another chain. Pinned in Task 7.
3. Admin page with a different account connected (MetaMask's second account): registration must be blocked, or the identity would be owned by the wrong address. The address comparison is case-insensitive. Pinned in Task 7.
4. Clicking Register again after success, or when `NEXT_PUBLIC_AGENT_ID` is already set, must be blocked so no duplicate identity is minted. Pinned in Task 7.
5. Para returns signatures without `0x` and with a recovery byte of 0/1 or 27/28. These must be normalised, and anything else rejected with a clear error. Pinned in Task 9.

---

## File Structure

```
.env.example                              all env keys with safe defaults (public values filled in)
vitest.config.ts                          test runner, "@/..." alias
src/app/layout.tsx                        fonts (IBM Plex), skip link, metadata
src/app/globals.css                       Cobro design tokens (OKLCH) on top of shadcn
src/app/page.tsx                          minimal home (brand, status, agent-card link)
src/app/agent-card.json/route.ts          ERC-8004 registration file
src/app/admin/agent/page.tsx              owner-only admin page (server shell)
src/app/admin/agent/agent-admin.tsx       admin client UI: connect, switch, register, verify
src/app/spike/para-login/page.tsx         Para sign-in spike page (server shell)
src/app/spike/para-login/para-login.tsx   Para sign-in spike client UI
src/app/spike/para-login/para-provider.tsx Para provider for the spike
src/app/api/spike/para-verify/route.ts    verifies a Para JWT server-side
src/components/providers/wallet-providers.tsx  wagmi + react-query providers
src/i18n/en.ts, src/i18n/index.ts         dictionary and t()
src/lib/chain/tokens.ts                   token registry, fee-currency adapters
src/lib/chain/attribution.ts              tag suffix helpers
src/lib/chain/clients.ts                  public client, tagged operator client
src/lib/config/parse.ts                   zod parse with readable errors
src/lib/config/public.ts                  NEXT_PUBLIC_* schema
src/lib/config/server.ts                  server-only schema
src/lib/identity/registry.ts              ERC-8004 address, ABI, Registered parser
src/lib/identity/agent-card.ts            agent card builder
src/lib/identity/admin-state.ts           registration guard (pure)
src/lib/wallet/wagmi-config.ts            wagmi config (Celo, injected)
src/lib/signer/signature.ts               signature normalisation
src/lib/signer/para-rest.ts               Para REST client
src/lib/auth/para-jwt.ts                  Para JWT verification
scripts/lib/env-file.ts                   .env.local line upsert (pure)
scripts/operator-keygen.ts                creates the operator key in .env.local
scripts/operator-selftest.ts              tagged self-transfer paying gas in a stablecoin
scripts/spike/para-rest.ts                live Para REST checks
public/cobro-mark.svg                     logo used by the agent card
docs/superpowers/spikes/2026-10-11-para.md spike results and decision
```

---

### Task 1: Scaffold the app, design tokens, i18n and test runner

**Files:**
- Create (scaffold): `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `next-env.d.ts`, `AGENTS.md`, `public/*`, `src/app/favicon.ico`
- Create (shadcn): `components.json`, `src/lib/utils.ts`, `src/components/ui/button.tsx`, `src/components/ui/card.tsx`
- Create: `vitest.config.ts`, `src/i18n/en.ts`, `src/i18n/index.ts`, `src/i18n/index.test.ts`
- Replace: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`

**Interfaces:**
- Produces: `t(key: MessageKey, vars?: Record<string, string | number>): string` and `type MessageKey` from `@/i18n`; dictionary object `en` in `src/i18n/en.ts` that later tasks extend; Tailwind token classes `bg-primary`, `text-success`, `text-warning`, `text-destructive`, `text-muted-foreground`, `font-mono`; `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

- [ ] **Step 1: Scaffold Next.js into a temp folder and copy it in**

The repo root already holds `docs/`, `design-system/` and `.gitignore`, so scaffold elsewhere and copy:

```bash
SCAFFOLD=$(mktemp -d)
npx --yes create-next-app@16.4.0 "$SCAFFOLD/app" --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --yes --no-agent-feedback
rsync -a --exclude node_modules --exclude .next --exclude .gitignore --exclude README.md "$SCAFFOLD/app/" ./
rm -rf "$SCAFFOLD"
npm install
npm pkg set name=cobro-agent
npm pkg set scripts.test="vitest run" scripts.typecheck="tsc --noEmit"
```

Expected: `package.json` lists `next@16.4.0`, `react@19.3.0`; `next.config.ts` contains `cacheComponents: true`.

- [ ] **Step 2: Initialise shadcn (Radix base) and add the components this plan uses**

```bash
npx --yes shadcn@4.21.4 init --base radix --defaults --yes --no-monorepo --pointer < /dev/null
npx --yes shadcn@4.21.4 add card --yes < /dev/null
```

Expected: `components.json` has `"style": "radix-nova"` and `"iconLibrary": "lucide"`; files `src/components/ui/{button,card}.tsx` exist.

- [ ] **Step 3: Install the test tooling**

```bash
npm install -D vitest@5.0.3 tsx@4.23.15
```

- [ ] **Step 4: Add the Vitest config**

`vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Write the failing i18n test**

`src/i18n/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { t } from "./index";

describe("t", () => {
  it("returns the English text for a key", () => {
    expect(t("app.name")).toBe("Cobro");
  });

  it("fills {placeholders} from vars", () => {
    expect(t("admin.registeredAs", { agentId: 9752 })).toBe("Registered as agent #9752");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(t("admin.registeredAs")).toBe("Registered as agent #{agentId}");
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./index"`.

- [ ] **Step 7: Implement the dictionary and `t()`**

`src/i18n/en.ts`:

```ts
export const en = {
  "app.name": "Cobro",
  "app.tagline": "Get paid in dollars or pesos. Your agent protects the rest.",
  "a11y.skipToContent": "Skip to main content",
  "home.status": "Cobro is being built for the Agents on Open Rails hackathon on Celo.",
  "home.agentCard": "View the agent's ERC-8004 card",
  "admin.registeredAs": "Registered as agent #{agentId}",
} as const;

export type MessageKey = keyof typeof en;
```

`src/i18n/index.ts`:

```ts
import { en, type MessageKey } from "./en";

export type { MessageKey };

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let text: string = en[key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
```

- [ ] **Step 8: Run the test to see it pass**

Run: `npm test`
Expected: PASS (3 tests).

- [ ] **Step 9: Replace `src/app/globals.css` with the Cobro tokens**

Values come from `design-system/cobro/MASTER.md`, converted to OKLCH. The `.dark` block keeps the shadcn defaults: dark mode is not shipped in the MVP, but the tokens stay complete.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-plex-sans);
  --font-mono: var(--font-plex-mono);
  --font-heading: var(--font-plex-sans);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

/* Cobro light palette — design-system/cobro/MASTER.md (hex → OKLCH) */
:root {
  --background: oklch(0.984 0.003 247.9); /* #F8FAFC */
  --foreground: oklch(0.208 0.04 265.8); /* #0F172A */
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.208 0.04 265.8);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.208 0.04 265.8);
  --primary: oklch(0.511 0.086 186.4); /* #0F766E */
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.968 0.007 247.9); /* #F1F5F9 */
  --secondary-foreground: oklch(0.208 0.04 265.8);
  --muted: oklch(0.968 0.007 247.9);
  --muted-foreground: oklch(0.446 0.037 257.3); /* #475569 */
  --accent: oklch(0.968 0.007 247.9);
  --accent-foreground: oklch(0.208 0.04 265.8);
  --destructive: oklch(0.577 0.215 27.3); /* #DC2626 */
  --success: oklch(0.527 0.137 150.1); /* #15803D */
  --success-foreground: oklch(1 0 0);
  --warning: oklch(0.555 0.146 49); /* #B45309 */
  --warning-foreground: oklch(1 0 0);
  --border: oklch(0.929 0.013 255.5); /* #E2E8F0, decorative */
  --input: oklch(0.554 0.041 257.4); /* #64748B, ≥3:1 boundary */
  --ring: oklch(0.511 0.086 186.4);
  --chart-1: oklch(0.511 0.086 186.4); /* spending bucket (local currency) */
  --chart-2: oklch(0.488 0.217 264.4); /* savings bucket (USD), #1D4ED8 */
  --chart-3: oklch(0.446 0.037 257.3);
  --chart-4: oklch(0.554 0.041 257.4);
  --chart-5: oklch(0.929 0.013 255.5);
  --radius: 0.5rem;
  --sidebar: oklch(1 0 0);
  --sidebar-foreground: oklch(0.208 0.04 265.8);
  --sidebar-primary: oklch(0.511 0.086 186.4);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.968 0.007 247.9);
  --sidebar-accent-foreground: oklch(0.208 0.04 265.8);
  --sidebar-border: oklch(0.929 0.013 255.5);
  --sidebar-ring: oklch(0.511 0.086 186.4);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --success: oklch(0.723 0.192 149.6);
  --success-foreground: oklch(0.145 0 0);
  --warning: oklch(0.769 0.188 70.1);
  --warning-foreground: oklch(0.145 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  button:not(:disabled),
  [role="button"]:not(:disabled) {
    cursor: pointer;
  }
  html {
    @apply font-sans;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 10: Replace `src/app/layout.tsx` (IBM Plex fonts, skip link)**

```tsx
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { t } from "@/i18n";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: t("app.name"),
  description: t("app.tagline"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:outline-2 focus:outline-ring"
        >
          {t("a11y.skipToContent")}
        </a>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 11: Replace `src/app/page.tsx` with the minimal home**

```tsx
import { t } from "@/i18n";

export default function Home() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-6 px-4 py-16 md:px-8"
    >
      <p className="text-sm font-medium text-primary">{t("app.name")}</p>
      <h1 className="max-w-[20ch] text-balance text-3xl font-semibold tracking-tight md:text-5xl">
        {t("app.tagline")}
      </h1>
      <p className="max-w-prose text-muted-foreground">{t("home.status")}</p>
    </main>
  );
}
```

- [ ] **Step 12: Verify everything builds**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: tests PASS; typecheck and lint print no errors; build ends with the route table listing `/`.

- [ ] **Step 13: Commit**

```bash
git add -A
git status --short   # confirm no .env*, node_modules or .next is staged
git commit -m "feat: scaffold Next.js app with Cobro design tokens, i18n and Vitest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Token registry and attribution tag helpers

**Files:**
- Create: `src/lib/chain/tokens.ts`, `src/lib/chain/tokens.test.ts`, `src/lib/chain/attribution.ts`, `src/lib/chain/attribution.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type TokenSymbol = "USDT" | "USAT" | "USDC" | "WARS" | "WBRL"`
  - `interface TokenInfo { symbol; address: Address; decimals: number; transferMethod: "eip3009" | "permit2"; eip712: { name: string; version: string }; feeCurrency?: Address }`
  - `TOKENS: Record<TokenSymbol, TokenInfo>`
  - `FEE_TOKENS = ["CELO", "USDT", "USDC", "USAT"] as const`, `type FeeToken`
  - `feeCurrencyFor(token: FeeToken): Address | undefined`
  - `ATTRIBUTION_CODE_PATTERN: RegExp`
  - `attributionSuffix(code: string): Hex`
  - `tagCalldata(data: Hex | undefined, code: string): Hex`
  - `hasAttribution(data: Hex, code: string): boolean`

- [ ] **Step 1: Install the chain libraries**

```bash
npm install viem@2.57.3 @celo/attribution-tags@0.5.0
```

- [ ] **Step 2: Write the failing tests**

`src/lib/chain/tokens.test.ts`:

```ts
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { FEE_TOKENS, TOKENS, feeCurrencyFor } from "./tokens";

describe("TOKENS", () => {
  it("stores checksummed addresses", () => {
    for (const token of Object.values(TOKENS)) {
      expect(token.address).toBe(getAddress(token.address));
      if (token.feeCurrency) expect(token.feeCurrency).toBe(getAddress(token.feeCurrency));
    }
  });

  it("uses 6 decimals for dollar stablecoins and 18 for wFIAT", () => {
    expect(TOKENS.USDT.decimals).toBe(6);
    expect(TOKENS.USAT.decimals).toBe(6);
    expect(TOKENS.USDC.decimals).toBe(6);
    expect(TOKENS.WARS.decimals).toBe(18);
    expect(TOKENS.WBRL.decimals).toBe(18);
  });

  it("keeps the on-chain EIP-712 names (wBRL is 'Real Brasileño')", () => {
    expect(TOKENS.WBRL.eip712).toEqual({ name: "Real Brasileño", version: "1" });
    expect(TOKENS.USAT.eip712).toEqual({ name: "Tether America USD", version: "1" });
  });
});

describe("feeCurrencyFor", () => {
  it("returns no fee currency for native CELO", () => {
    expect(feeCurrencyFor("CELO")).toBeUndefined();
  });

  it("returns the adapter, not the token, for 6-decimal stablecoins", () => {
    expect(feeCurrencyFor("USDT")).toBe("0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72");
    expect(feeCurrencyFor("USDC")).toBe("0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B");
    expect(feeCurrencyFor("USAT")).toBe("0x0357EE22278c922e1D36cFe6b899269b161880C4");
  });

  it("covers every fee token", () => {
    expect(FEE_TOKENS).toEqual(["CELO", "USDT", "USDC", "USAT"]);
  });
});
```

`src/lib/chain/attribution.test.ts`:

```ts
import { concat, encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { attributionSuffix, hasAttribution, tagCalldata } from "./attribution";

const CODE = "celo_bc3965e128ba";
// celo.dataSuffix returned by `loops project get --event agents-on-open-rails`
const LOOPS_SUFFIX = "0x63656c6f5f626333393635653132386261110080218021802180218021802180218021";

describe("attributionSuffix", () => {
  it("matches the suffix Loops House issued for our entry", () => {
    expect(attributionSuffix(CODE)).toBe(LOOPS_SUFFIX);
  });

  it("rejects a code that is not celo_ plus 12 hex characters", () => {
    expect(() => attributionSuffix("celo_bc3965e128b")).toThrow(/attribution code/i);
    expect(() => attributionSuffix("CELO_BC3965E128BA")).toThrow(/attribution code/i);
  });
});

describe("tagCalldata", () => {
  const transfer = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: ["0x000000000000000000000000000000000000dEaD", 1n],
  });

  it("appends the suffix to existing calldata", () => {
    expect(tagCalldata(transfer, CODE)).toBe(concat([transfer, LOOPS_SUFFIX]));
  });

  it("uses the bare suffix when there is no calldata", () => {
    expect(tagCalldata(undefined, CODE)).toBe(LOOPS_SUFFIX);
    expect(tagCalldata("0x", CODE)).toBe(LOOPS_SUFFIX);
  });
});

describe("hasAttribution", () => {
  it("finds our code at the end of tagged calldata", () => {
    expect(hasAttribution(concat(["0xa9059cbb", LOOPS_SUFFIX]), CODE)).toBe(true);
  });

  it("is false for untagged calldata or another code", () => {
    expect(hasAttribution("0xa9059cbb", CODE)).toBe(false);
    expect(hasAttribution(attributionSuffix("celo_000000000000"), CODE)).toBe(false);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npm test -- src/lib/chain`
Expected: FAIL, `Failed to resolve import "./tokens"` and `"./attribution"`.

- [ ] **Step 4: Implement `tokens.ts`**

```ts
import type { Address } from "viem";

export type TokenSymbol = "USDT" | "USAT" | "USDC" | "WARS" | "WBRL";
export type TransferMethod = "eip3009" | "permit2";

export interface TokenInfo {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
  transferMethod: TransferMethod;
  /** EIP-712 domain, read on-chain (name(), eip712Domain()) on 2026-10-08. */
  eip712: { name: string; version: string };
  /** CIP-64 `feeCurrency` value. 6-decimal tokens go through an adapter. */
  feeCurrency?: Address;
}

export const TOKENS: Record<TokenSymbol, TokenInfo> = {
  USDT: {
    symbol: "USDT",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    decimals: 6,
    transferMethod: "eip3009",
    eip712: { name: "Tether USD", version: "1" },
    feeCurrency: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72",
  },
  USAT: {
    symbol: "USAT",
    address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
    decimals: 6,
    transferMethod: "eip3009",
    eip712: { name: "Tether America USD", version: "1" },
    feeCurrency: "0x0357EE22278c922e1D36cFe6b899269b161880C4",
  },
  USDC: {
    symbol: "USDC",
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
    transferMethod: "eip3009",
    eip712: { name: "USDC", version: "2" },
    feeCurrency: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
  },
  WARS: {
    symbol: "WARS",
    address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D",
    decimals: 18,
    transferMethod: "permit2",
    eip712: { name: "Peso Argentino", version: "1" },
  },
  WBRL: {
    symbol: "WBRL",
    address: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0",
    decimals: 18,
    transferMethod: "permit2",
    eip712: { name: "Real Brasileño", version: "1" },
  },
};

export const FEE_TOKENS = ["CELO", "USDT", "USDC", "USAT"] as const;
export type FeeToken = (typeof FEE_TOKENS)[number];

export function feeCurrencyFor(token: FeeToken): Address | undefined {
  return token === "CELO" ? undefined : TOKENS[token].feeCurrency;
}
```

- [ ] **Step 5: Implement `attribution.ts`**

```ts
import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";

export const ATTRIBUTION_CODE_PATTERN = /^celo_[0-9a-f]{12}$/;

export function attributionSuffix(code: string): Hex {
  if (!ATTRIBUTION_CODE_PATTERN.test(code)) {
    throw new Error(`Invalid attribution code "${code}": expected celo_ followed by 12 lowercase hex characters`);
  }
  return toDataSuffix(code) as Hex;
}

export function tagCalldata(data: Hex | undefined, code: string): Hex {
  const suffix = attributionSuffix(code);
  return data && data !== "0x" ? concat([data, suffix]) : suffix;
}

export function hasAttribution(data: Hex, code: string): boolean {
  return fromDataSuffix(data)?.codes.includes(code) ?? false;
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npm test -- src/lib/chain`
Expected: PASS (12 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/chain
git commit -m "feat(chain): add token registry and attribution tag helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Environment configuration

**Files:**
- Create: `src/lib/config/parse.ts`, `src/lib/config/public.ts`, `src/lib/config/server.ts`, `src/lib/config/config.test.ts`, `.env.example`
- Create locally (not committed): `.env.local`

**Interfaces:**
- Consumes: `FEE_TOKENS` from `@/lib/chain/tokens`.
- Produces:
  - `parsePublicEnv(source: Record<string, string | undefined>): PublicEnv`
  - `readPublicEnv(): PublicEnv`
  - `type PublicEnv = { NEXT_PUBLIC_APP_URL: string; NEXT_PUBLIC_ATTRIBUTION_CODE: string; NEXT_PUBLIC_AGENT_WALLET: Address; NEXT_PUBLIC_AGENT_ID?: number }`
  - `parseServerEnv(source?: Record<string, string | undefined>): ServerEnv`
  - `type ServerEnv = { CELO_RPC_URL: string; OPERATOR_PRIVATE_KEY?: Hex; OPERATOR_FEE_TOKEN: FeeToken; PARA_API_KEY?: string; PARA_REST_BASE_URL: string; PARA_JWKS_URL: string }`
  - `requireValue<T>(value: T | undefined, name: string): T`

- [ ] **Step 1: Install zod**

```bash
npm install zod@4.6.5
```

- [ ] **Step 2: Write the failing tests**

`src/lib/config/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./public";
import { parseServerEnv, requireValue } from "./server";

const validPublic = {
  NEXT_PUBLIC_APP_URL: "https://cobro-agent.vercel.app/",
  NEXT_PUBLIC_ATTRIBUTION_CODE: "celo_bc3965e128ba",
  NEXT_PUBLIC_AGENT_WALLET: "0x64ad61211c1b0b7f20b3e04b49661f30f152ae78",
  NEXT_PUBLIC_AGENT_ID: "",
};

describe("parsePublicEnv", () => {
  it("parses valid values, trims the URL's trailing slash and checksums the wallet", () => {
    const env = parsePublicEnv(validPublic);
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://cobro-agent.vercel.app");
    expect(env.NEXT_PUBLIC_AGENT_WALLET).toBe("0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78");
    expect(env.NEXT_PUBLIC_AGENT_ID).toBeUndefined();
  });

  it("reads the agent id as a number once it is set", () => {
    expect(parsePublicEnv({ ...validPublic, NEXT_PUBLIC_AGENT_ID: "9752" }).NEXT_PUBLIC_AGENT_ID).toBe(9752);
  });

  it("names the variable when the attribution code is mistyped", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_ATTRIBUTION_CODE: "celo_bc3965e128b" })).toThrow(
      /NEXT_PUBLIC_ATTRIBUTION_CODE/,
    );
  });

  it("names the variable when the app URL is missing", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_APP_URL: undefined })).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("rejects a malformed agent wallet", () => {
    expect(() => parsePublicEnv({ ...validPublic, NEXT_PUBLIC_AGENT_WALLET: "0x1234" })).toThrow(
      /NEXT_PUBLIC_AGENT_WALLET/,
    );
  });
});

describe("parseServerEnv", () => {
  it("applies defaults when nothing is set", () => {
    const env = parseServerEnv({});
    expect(env.CELO_RPC_URL).toBe("https://forno.celo.org");
    expect(env.OPERATOR_FEE_TOKEN).toBe("USDT");
    expect(env.PARA_REST_BASE_URL).toBe("https://api.beta.getpara.com");
    expect(env.PARA_JWKS_URL).toBe("https://api.beta.getpara.com/.well-known/jwks.json");
    expect(env.OPERATOR_PRIVATE_KEY).toBeUndefined();
  });

  it("treats empty strings from .env files as unset", () => {
    const env = parseServerEnv({ OPERATOR_PRIVATE_KEY: "", PARA_API_KEY: "", OPERATOR_FEE_TOKEN: "" });
    expect(env.OPERATOR_PRIVATE_KEY).toBeUndefined();
    expect(env.PARA_API_KEY).toBeUndefined();
    expect(env.OPERATOR_FEE_TOKEN).toBe("USDT");
  });

  it("rejects a malformed private key without echoing it", () => {
    let message = "";
    try {
      parseServerEnv({ OPERATOR_PRIVATE_KEY: "0xdeadbeef" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/OPERATOR_PRIVATE_KEY/);
    expect(message).not.toMatch(/deadbeef/);
  });

  it("rejects an unknown fee token", () => {
    expect(() => parseServerEnv({ OPERATOR_FEE_TOKEN: "DAI" })).toThrow(/OPERATOR_FEE_TOKEN/);
  });
});

describe("requireValue", () => {
  it("returns the value or throws naming the variable", () => {
    expect(requireValue("x", "A")).toBe("x");
    expect(() => requireValue(undefined, "PARA_API_KEY")).toThrow("PARA_API_KEY is not set");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npm test -- src/lib/config`
Expected: FAIL, `Failed to resolve import "./public"`.

- [ ] **Step 4: Implement the shared parser**

`src/lib/config/parse.ts`:

```ts
import type { z } from "zod";

/** Turns "" (an unset line in a .env file) into undefined so defaults apply. */
export function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

/** Parses or throws one readable error that names each bad variable but never echoes its value. */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid ${label} environment: ${details}`);
  }
  return result.data;
}
```

- [ ] **Step 5: Implement the public schema**

`src/lib/config/public.ts`:

```ts
import { getAddress } from "viem";
import { z } from "zod";
import { ATTRIBUTION_CODE_PATTERN } from "@/lib/chain/attribution";
import { emptyToUndefined, parseOrThrow } from "./parse";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .url({ protocol: /^https?$/ })
    .transform((url) => url.replace(/\/+$/, "")),
  NEXT_PUBLIC_ATTRIBUTION_CODE: z
    .string()
    .regex(ATTRIBUTION_CODE_PATTERN, "must be celo_ followed by 12 lowercase hex characters"),
  NEXT_PUBLIC_AGENT_WALLET: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address")
    .transform((address) => getAddress(address)),
  NEXT_PUBLIC_AGENT_ID: z.preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional()),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  return parseOrThrow(publicEnvSchema, source, "public");
}

/** Next.js inlines NEXT_PUBLIC_* only where each variable is written out literally. */
export function readPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ATTRIBUTION_CODE: process.env.NEXT_PUBLIC_ATTRIBUTION_CODE,
    NEXT_PUBLIC_AGENT_WALLET: process.env.NEXT_PUBLIC_AGENT_WALLET,
    NEXT_PUBLIC_AGENT_ID: process.env.NEXT_PUBLIC_AGENT_ID,
  });
}
```

- [ ] **Step 6: Implement the server schema**

`src/lib/config/server.ts`:

```ts
import type { Hex } from "viem";
import { z } from "zod";
import { FEE_TOKENS } from "@/lib/chain/tokens";
import { emptyToUndefined, parseOrThrow } from "./parse";

const serverEnvSchema = z.object({
  CELO_RPC_URL: z.preprocess(emptyToUndefined, z.url().default("https://forno.celo.org")),
  OPERATOR_PRIVATE_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key")
      .transform((key) => key as Hex)
      .optional(),
  ),
  OPERATOR_FEE_TOKEN: z.preprocess(emptyToUndefined, z.enum(FEE_TOKENS).default("USDT")),
  PARA_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  PARA_REST_BASE_URL: z.preprocess(emptyToUndefined, z.url().default("https://api.beta.getpara.com")),
  PARA_JWKS_URL: z.preprocess(
    emptyToUndefined,
    z.url().default("https://api.beta.getpara.com/.well-known/jwks.json"),
  ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  return parseOrThrow(serverEnvSchema, source, "server");
}

export function requireValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npm test -- src/lib/config`
Expected: PASS (10 tests). If the private-key test fails because the message contains `deadbeef`, zod is echoing input. Keep the custom regex message, which does not include the value.

- [ ] **Step 8: Add `.env.example` and create `.env.local` from it**

`.env.example`:

```bash
# ---- Public: inlined into the browser bundle, safe to share ----
# Production URL of the app (Task 6 confirms the real Vercel domain)
NEXT_PUBLIC_APP_URL=https://cobro-agent.vercel.app
# Issued by Loops House at enrollment (loops project get --event agents-on-open-rails)
NEXT_PUBLIC_ATTRIBUTION_CODE=celo_bc3965e128ba
# Declared agent wallet on Loops (the user's browser wallet; its key never comes here)
NEXT_PUBLIC_AGENT_WALLET=0x64ad61211c1b0b7f20b3e04b49661f30f152ae78
# Set after the ERC-8004 registration in Task 7
NEXT_PUBLIC_AGENT_ID=

# ---- Server only ----
CELO_RPC_URL=https://forno.celo.org
# Written by `npx tsx scripts/operator-keygen.ts`; never paste or commit a real value
OPERATOR_PRIVATE_KEY=
# Gas token for the operator wallet: CELO, USDT, USDC or USAT
OPERATOR_FEE_TOKEN=USDT
# Para secret REST key (developer.getpara.com); server only
PARA_API_KEY=
PARA_REST_BASE_URL=https://api.beta.getpara.com
PARA_JWKS_URL=https://api.beta.getpara.com/.well-known/jwks.json

# ---- Para sign-in spike (public client key) ----
NEXT_PUBLIC_PARA_API_KEY=
NEXT_PUBLIC_PARA_ENVIRONMENT=BETA
```

```bash
cp .env.example .env.local
chmod 600 .env.local
git check-ignore .env.local   # must print .env.local
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/lib/config .env.example
git commit -m "feat(config): validate public and server environment with zod

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Celo clients with tagged operator sends

**Files:**
- Create: `src/lib/chain/clients.ts`, `src/lib/chain/clients.test.ts`

**Interfaces:**
- Consumes: `attributionSuffix`, `feeCurrencyFor`, `type FeeToken` (Task 2).
- Produces:
  - `createCeloPublicClient(rpcUrl: string, transport?: Transport): PublicClient` on the `celo` chain
  - `createOperatorClient(opts: { privateKey: Hex; attributionCode: string; rpcUrl: string; transport?: Transport })`, a viem wallet client on `celo` whose `sendTransaction` and `writeContract` append the tag
  - `operatorSendParams(feeToken: FeeToken): { feeCurrency?: Address }`, spread into `sendTransaction` calls

- [ ] **Step 1: Write the failing test**

`src/lib/chain/clients.test.ts`:

```ts
import { custom, parseGwei, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseTransaction } from "viem/celo";
import { describe, expect, it } from "vitest";
import { attributionSuffix } from "./attribution";
import { createOperatorClient, operatorSendParams } from "./clients";

const CODE = "celo_bc3965e128ba";

/** Fake RPC that only knows the chain id and captures the raw transaction. */
function captureTransport() {
  const captured: { raw?: Hex } = {};
  const transport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return "0xa4ec";
      if (method === "eth_sendRawTransaction") {
        captured.raw = (params as [Hex])[0];
        return `0x${"11".repeat(32)}`;
      }
      throw new Error(`unexpected RPC ${method}`);
    },
  });
  return { transport, captured };
}

const fixedGas = { gas: 60_000n, maxFeePerGas: parseGwei("30"), maxPriorityFeePerGas: parseGwei("1"), nonce: 0 };

describe("createOperatorClient", () => {
  it("tags a plain self-transfer and pays gas through the USDT adapter (CIP-64)", async () => {
    const { transport, captured } = captureTransport();
    const privateKey = generatePrivateKey();
    const client = createOperatorClient({ privateKey, attributionCode: CODE, rpcUrl: "http://unused", transport });
    const self = privateKeyToAccount(privateKey).address;

    await client.sendTransaction({ to: self, value: 0n, ...operatorSendParams("USDT"), ...fixedGas });

    const tx = parseTransaction(captured.raw!);
    expect(tx.type).toBe("cip64");
    expect(tx.feeCurrency?.toLowerCase()).toBe("0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72");
    expect(tx.data).toBe(attributionSuffix(CODE));
  });

  it("appends the tag after existing calldata", async () => {
    const { transport, captured } = captureTransport();
    const client = createOperatorClient({ privateKey: generatePrivateKey(), attributionCode: CODE, rpcUrl: "http://unused", transport });

    await client.sendTransaction({
      to: "0x000000000000000000000000000000000000dEaD",
      data: "0xa9059cbb",
      ...operatorSendParams("USDC"),
      ...fixedGas,
    });

    const tx = parseTransaction(captured.raw!);
    expect(tx.data?.startsWith("0xa9059cbb")).toBe(true);
    expect(tx.data?.endsWith(attributionSuffix(CODE).slice(2))).toBe(true);
  });

  it("sends a normal EIP-1559 transaction when gas is paid in CELO", async () => {
    const { transport, captured } = captureTransport();
    const client = createOperatorClient({ privateKey: generatePrivateKey(), attributionCode: CODE, rpcUrl: "http://unused", transport });

    await client.sendTransaction({
      to: "0x000000000000000000000000000000000000dEaD",
      value: 0n,
      ...operatorSendParams("CELO"),
      ...fixedGas,
    });

    const tx = parseTransaction(captured.raw!);
    expect(tx.type).toBe("eip1559");
    expect(tx.data).toBe(attributionSuffix(CODE));
  });

  it("refuses an invalid attribution code before sending anything", () => {
    expect(() =>
      createOperatorClient({ privateKey: generatePrivateKey(), attributionCode: "celo_x", rpcUrl: "http://unused" }),
    ).toThrow(/attribution code/i);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/lib/chain/clients`
Expected: FAIL, `Failed to resolve import "./clients"`.

- [ ] **Step 3: Implement `clients.ts`**

```ts
import { withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, http, type Address, type Hex, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { attributionSuffix } from "./attribution";
import { feeCurrencyFor, type FeeToken } from "./tokens";

export function createCeloPublicClient(rpcUrl: string, transport?: Transport) {
  return createPublicClient({ chain: celo, transport: transport ?? http(rpcUrl) });
}

/** Wallet client whose sendTransaction and writeContract always carry our attribution tag. */
export function createOperatorClient(opts: {
  privateKey: Hex;
  attributionCode: string;
  rpcUrl: string;
  transport?: Transport;
}) {
  attributionSuffix(opts.attributionCode); // validates the code before any client exists
  const account = privateKeyToAccount(opts.privateKey);
  return createWalletClient({ account, chain: celo, transport: opts.transport ?? http(opts.rpcUrl) }).extend(
    withAttribution(opts.attributionCode),
  );
}

/** Spread into sendTransaction/writeContract so gas is paid in the configured token. */
export function operatorSendParams(feeToken: FeeToken): { feeCurrency?: Address } {
  const feeCurrency = feeCurrencyFor(feeToken);
  return feeCurrency ? { feeCurrency } : {};
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test -- src/lib/chain`
Expected: PASS (16 tests). viem probes `eth_fillTransaction` first; the fake transport throws for it and viem falls back to local filling. This is expected.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chain/clients.ts src/lib/chain/clients.test.ts
git commit -m "feat(chain): add tagged operator client with stablecoin gas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Agent identity: registry ABI, agent card route and logo

**Files:**
- Create: `src/lib/identity/registry.ts`, `src/lib/identity/registry.test.ts`, `src/lib/identity/agent-card.ts`, `src/lib/identity/agent-card.test.ts`, `src/app/agent-card.json/route.ts`, `public/cobro-mark.svg`
- Modify: `src/app/page.tsx` (link to the card)

**Interfaces:**
- Consumes: `readPublicEnv()` (Task 3), `t()` (Task 1).
- Produces:
  - `IDENTITY_REGISTRY: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"`
  - `AGENT_REGISTRY_ID: "eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"`
  - `identityRegistryAbi`, which holds `register(string agentURI) returns (uint256)` and `event Registered(uint256 indexed agentId, string agentURI, address indexed owner)`
  - `extractRegisteredAgentId(logs: readonly Log[]): bigint | null`
  - `buildAgentCard(input: { appUrl: string; agentId?: number }): AgentCard`
  - `agentCardUrl(appUrl: string): string`
  - Route `GET /agent-card.json`

- [ ] **Step 1: Write the failing tests**

`src/lib/identity/registry.test.ts`:

```ts
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
```

`src/lib/identity/agent-card.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- src/lib/identity`
Expected: FAIL, `Failed to resolve import "./registry"` and `"./agent-card"`.

- [ ] **Step 3: Implement `registry.ts`**

```ts
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
```

- [ ] **Step 4: Implement `agent-card.ts`**

```ts
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
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test -- src/lib/identity`
Expected: PASS (7 tests).

- [ ] **Step 6: Add the route handler**

Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` first. With Cache Components on, a `GET` handler that reads no request data is prerendered at build time, so setting `NEXT_PUBLIC_AGENT_ID` needs a redeploy (Task 7 does that).

`src/app/agent-card.json/route.ts`:

```ts
import { readPublicEnv } from "@/lib/config/public";
import { buildAgentCard } from "@/lib/identity/agent-card";

export function GET() {
  const env = readPublicEnv();
  const card = buildAgentCard({ appUrl: env.NEXT_PUBLIC_APP_URL, agentId: env.NEXT_PUBLIC_AGENT_ID });
  return Response.json(card, { headers: { "Access-Control-Allow-Origin": "*" } });
}
```

- [ ] **Step 7: Add the logo**

`public/cobro-mark.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Cobro"><rect width="64" height="64" rx="14" fill="#0F766E"/><path d="M42 22.5a13 13 0 1 0 0 19" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"/></svg>
```

- [ ] **Step 8: Link the card from the home page**

Replace `src/app/page.tsx`:

```tsx
import Link from "next/link";
import { t } from "@/i18n";

export default function Home() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-6 px-4 py-16 md:px-8"
    >
      <p className="text-sm font-medium text-primary">{t("app.name")}</p>
      <h1 className="max-w-[20ch] text-balance text-3xl font-semibold tracking-tight md:text-5xl">
        {t("app.tagline")}
      </h1>
      <p className="max-w-prose text-muted-foreground">{t("home.status")}</p>
      <Link
        href="/agent-card.json"
        className="w-fit rounded-sm text-primary underline underline-offset-4 transition-colors hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t("home.agentCard")}
      </Link>
    </main>
  );
}
```

- [ ] **Step 9: Verify the card locally**

```bash
npm run build && (npm run start > /tmp/cobro-start.log 2>&1 &) && sleep 4
curl -s http://localhost:3000/agent-card.json | python3 -m json.tool
pkill -f "next start"
```

Expected: JSON with `"name": "Cobro"`, `"image": "https://cobro-agent.vercel.app/cobro-mark.svg"` and `"registrations": []`. Build output marks `/agent-card.json` as prerendered (static).

- [ ] **Step 10: Commit**

```bash
git add src/lib/identity src/app/agent-card.json src/app/page.tsx public/cobro-mark.svg
git commit -m "feat(identity): serve ERC-8004 agent card and parse Registered events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Deploy to Vercel (user-assisted)

**Files:**
- Modify (only if the Vercel domain differs): `.env.example` (`NEXT_PUBLIC_APP_URL`)

**Interfaces:**
- Consumes: the app from Tasks 1–5.
- Produces: a public HTTPS URL serving `/agent-card.json`. Task 7 registers `agentCardUrl(NEXT_PUBLIC_APP_URL)` on-chain, so this URL must be final.

- [ ] **Step 1: Push the branch**

```bash
git push
```

- [ ] **Step 2: User imports the repo on Vercel**

Ask the user to:
1. Open https://vercel.com/new and import `hms1499/cobro-agent` (framework preset: Next.js, root directory `./`).
2. Add Environment Variables (Production and Preview):
   `NEXT_PUBLIC_APP_URL=https://cobro-agent.vercel.app`, `NEXT_PUBLIC_ATTRIBUTION_CODE=celo_bc3965e128ba`, `NEXT_PUBLIC_AGENT_WALLET=0x64ad61211c1b0b7f20b3e04b49661f30f152ae78`.
3. Deploy, then report the production domain Vercel assigned.

If the domain is not `cobro-agent.vercel.app`, set `NEXT_PUBLIC_APP_URL` to the real domain in Vercel, `.env.local` and `.env.example`, redeploy, and commit `.env.example`.

- [ ] **Step 3: Verify the live card**

```bash
APP_URL=https://cobro-agent.vercel.app   # the confirmed domain
curl -s -o /dev/null -w "%{http_code}\n" "$APP_URL/agent-card.json"
curl -s "$APP_URL/agent-card.json" | python3 -c "import json,sys; c=json.load(sys.stdin); assert c['name']=='Cobro' and c['image'].startswith('$APP_URL'), c; print('card OK', c['image'])"
curl -s -o /dev/null -w "%{http_code}\n" "$APP_URL/cobro-mark.svg"
```

Expected: `200`, `card OK https://…/cobro-mark.svg`, `200`.

- [ ] **Step 4: Commit (only if `.env.example` changed)**

```bash
git add .env.example
git commit -m "chore: point NEXT_PUBLIC_APP_URL at the Vercel domain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Agent admin page and ERC-8004 registration (first tagged mainnet transaction)

**Files:**
- Create: `src/lib/identity/admin-state.ts`, `src/lib/identity/admin-state.test.ts`, `src/lib/wallet/wagmi-config.ts`, `src/components/providers/wallet-providers.tsx`, `src/app/admin/agent/page.tsx`, `src/app/admin/agent/agent-admin.tsx`, `scripts/verify-tx.ts`
- Modify: `src/i18n/en.ts` (admin strings)

**Interfaces:**
- Consumes: `IDENTITY_REGISTRY`, `identityRegistryAbi`, `extractRegisteredAgentId`, `agentCardUrl` (Task 5); `attributionSuffix` (Task 2); `readPublicEnv` (Task 3); `t` (Task 1).
- Produces:
  - `type RegistrationBlocker = "already-registered" | "not-connected" | "wrong-wallet" | "wrong-network" | "pending"`
  - `registrationBlocker(input: { connectedAddress?: string; chainId?: number; agentWallet: string; registeredAgentId?: number | bigint; isPending: boolean }): RegistrationBlocker | null`
  - `wagmiConfig`, `<WalletProviders>`, reused by the payment page in Plan 2
  - Page `/admin/agent`

- [ ] **Step 1: Install the wallet libraries**

```bash
npm install wagmi@3.7.7 @tanstack/react-query@5.104.1
```

- [ ] **Step 2: Write the failing guard test**

`src/lib/identity/admin-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { registrationBlocker } from "./admin-state";

const agentWallet = "0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78";
const ready = { connectedAddress: agentWallet.toLowerCase(), chainId: 42220, agentWallet, isPending: false };

describe("registrationBlocker", () => {
  it("allows registration from the agent wallet on Celo", () => {
    expect(registrationBlocker(ready)).toBeNull();
  });

  it("compares addresses case-insensitively", () => {
    expect(registrationBlocker({ ...ready, connectedAddress: agentWallet.toUpperCase().replace("0X", "0x") })).toBeNull();
  });

  it("blocks when no wallet is connected", () => {
    expect(registrationBlocker({ ...ready, connectedAddress: undefined })).toBe("not-connected");
  });

  it("blocks a different account, which would own the identity", () => {
    expect(registrationBlocker({ ...ready, connectedAddress: "0x000000000000000000000000000000000000dEaD" })).toBe(
      "wrong-wallet",
    );
  });

  it("blocks any network other than Celo mainnet", () => {
    expect(registrationBlocker({ ...ready, chainId: 1 })).toBe("wrong-network");
    expect(registrationBlocker({ ...ready, chainId: 11142220 })).toBe("wrong-network");
    expect(registrationBlocker({ ...ready, chainId: undefined })).toBe("wrong-network");
  });

  it("blocks a second registration once an agent id exists", () => {
    expect(registrationBlocker({ ...ready, registeredAgentId: 9752 })).toBe("already-registered");
    expect(registrationBlocker({ ...ready, registeredAgentId: 9752n })).toBe("already-registered");
    expect(registrationBlocker({ ...ready, registeredAgentId: 0 })).toBe("already-registered");
  });

  it("blocks double submission while a transaction is pending", () => {
    expect(registrationBlocker({ ...ready, isPending: true })).toBe("pending");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- src/lib/identity/admin-state`
Expected: FAIL, `Failed to resolve import "./admin-state"`.

- [ ] **Step 4: Implement the guard**

`src/lib/identity/admin-state.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npm test -- src/lib/identity/admin-state`
Expected: PASS (7 tests).

- [ ] **Step 6: Add the wagmi config and providers**

`src/lib/wallet/wagmi-config.ts`:

```ts
import { createConfig, http, injected } from "wagmi";
import { celo } from "wagmi/chains";

export const wagmiConfig = createConfig({
  chains: [celo],
  connectors: [injected()],
  transports: { [celo.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
```

`src/components/providers/wallet-providers.tsx`:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wallet/wagmi-config";

export function WalletProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
```

- [ ] **Step 7: Add the admin strings**

Add these entries to the `en` object in `src/i18n/en.ts` (keep `admin.registeredAs` from Task 1):

```ts
  "admin.title": "Agent wallet",
  "admin.intro":
    "Register Cobro's ERC-8004 identity from the agent wallet declared on Loops. Your wallet signs; no key leaves it.",
  "admin.factWallet": "Agent wallet",
  "admin.factCard": "Agent card",
  "admin.factTag": "Attribution tag",
  "admin.connect": "Connect wallet",
  "admin.switch": "Switch to Celo",
  "admin.register": "Register Cobro identity",
  "admin.retry": "Try again",
  "admin.wrongWallet": "The connected wallet is not the agent wallet. Switch accounts in your wallet.",
  "admin.signing": "Confirm the transaction in your wallet…",
  "admin.confirming": "Waiting for Celo to confirm…",
  "admin.tagFound": "Attribution tag found in the transaction",
  "admin.tagMissing": "Attribution tag missing. Stop and check the wiring before sending anything else.",
  "admin.viewTx": "View transaction on Celoscan",
  "admin.nextSteps": "Next: set NEXT_PUBLIC_AGENT_ID={agentId} in Vercel and .env.local, then redeploy.",
  "admin.errorNoEvent": "The transaction did not emit a Registered event.",
  "admin.noWallet": "No browser wallet found. Install MetaMask or Rabby, or open this page in your wallet's browser.",
```

- [ ] **Step 8: Build the admin client UI**

Before writing UI, read `design-system/cobro/MASTER.md` and use the `ui-ux-pro-max` skill for any layout question. Rules that apply here: one primary button; chips with icon and text; `aria-live` status; mono font only for addresses.

`src/app/admin/agent/agent-admin.tsx`:

```tsx
"use client";

import { verifyTx } from "@celo/attribution-tags";
import { CircleAlert, CircleCheck, Clock, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { Hex } from "viem";
import { useConnect, useConnection, useConnectors, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { celo } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { attributionSuffix } from "@/lib/chain/attribution";
import { registrationBlocker } from "@/lib/identity/admin-state";
import { agentCardUrl } from "@/lib/identity/agent-card";
import { IDENTITY_REGISTRY, extractRegisteredAgentId, identityRegistryAbi } from "@/lib/identity/registry";

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "confirming"; hash: Hex }
  | { kind: "done"; hash: Hex; agentId: bigint; tagged: boolean }
  | { kind: "error"; message: string };

interface Props {
  appUrl: string;
  attributionCode: string;
  agentWallet: string;
  agentId?: number;
}

export function AgentAdmin({ appUrl, attributionCode, agentWallet, agentId }: Props) {
  const connection = useConnection();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: celo.id });
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const registeredAgentId = phase.kind === "done" ? phase.agentId : agentId;
  const blocker = registrationBlocker({
    connectedAddress: connection.address,
    chainId: connection.chainId,
    agentWallet,
    registeredAgentId,
    isPending: phase.kind === "signing" || phase.kind === "confirming",
  });

  async function connect() {
    const connector = connectors[0];
    if (!connector) {
      setPhase({ kind: "error", message: t("admin.noWallet") });
      return;
    }
    await connectAsync({ connector, chainId: celo.id });
  }

  async function register() {
    if (!publicClient || blocker !== null) return;
    setPhase({ kind: "signing" });
    try {
      const hash = await writeContractAsync({
        address: IDENTITY_REGISTRY,
        abi: identityRegistryAbi,
        functionName: "register",
        args: [agentCardUrl(appUrl)],
        chainId: celo.id,
        dataSuffix: attributionSuffix(attributionCode),
      });
      setPhase({ kind: "confirming", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const newAgentId = extractRegisteredAgentId(receipt.logs);
      if (receipt.status !== "success" || newAgentId === null) throw new Error(t("admin.errorNoEvent"));
      const decoded = await verifyTx({ client: publicClient, hash });
      setPhase({ kind: "done", hash, agentId: newAgentId, tagged: decoded?.codes.includes(attributionCode) ?? false });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">{t("admin.title")}</CardTitle>
        <CardDescription>{t("admin.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("admin.factWallet")}</dt>
            <dd className="font-mono break-all">{agentWallet}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("admin.factCard")}</dt>
            <dd className="font-mono break-all">{agentCardUrl(appUrl)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("admin.factTag")}</dt>
            <dd className="font-mono">{attributionCode}</dd>
          </div>
        </dl>

        <div aria-live="polite" className="flex flex-col gap-3">
          {registeredAgentId !== undefined && (
            <p className="flex items-center gap-2 font-medium text-success">
              <CircleCheck aria-hidden="true" className="size-5" />
              {t("admin.registeredAs", { agentId: registeredAgentId.toString() })}
            </p>
          )}
          {phase.kind === "done" && (
            <>
              <p className={`flex items-center gap-2 ${phase.tagged ? "text-success" : "text-destructive"}`}>
                {phase.tagged ? (
                  <CircleCheck aria-hidden="true" className="size-5" />
                ) : (
                  <CircleAlert aria-hidden="true" className="size-5" />
                )}
                {phase.tagged ? t("admin.tagFound") : t("admin.tagMissing")}
              </p>
              <a
                href={`https://celoscan.io/tx/${phase.hash}`}
                target="_blank"
                rel="noreferrer"
                className="flex w-fit items-center gap-1 rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t("admin.viewTx")}
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
              <p className="text-sm text-muted-foreground">
                {t("admin.nextSteps", { agentId: phase.agentId.toString() })}
              </p>
            </>
          )}
          {(phase.kind === "signing" || phase.kind === "confirming") && (
            <p className="flex items-center gap-2 text-warning">
              <Clock aria-hidden="true" className="size-5" />
              {phase.kind === "signing" ? t("admin.signing") : t("admin.confirming")}
            </p>
          )}
          {blocker === "wrong-wallet" && (
            <p className="flex items-center gap-2 text-destructive">
              <CircleAlert aria-hidden="true" className="size-5" />
              {t("admin.wrongWallet")}
            </p>
          )}
          {phase.kind === "error" && (
            <p className="flex items-start gap-2 text-destructive" role="alert">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              <span className="break-words">{phase.message}</span>
            </p>
          )}
        </div>

        {blocker === "not-connected" && (
          <Button size="lg" className="min-h-11" onClick={connect}>
            {t("admin.connect")}
          </Button>
        )}
        {blocker === "wrong-network" && (
          <Button size="lg" className="min-h-11" onClick={() => switchChainAsync({ chainId: celo.id })}>
            {t("admin.switch")}
          </Button>
        )}
        {(blocker === null || blocker === "pending") && (
          <Button size="lg" className="min-h-11" onClick={register} disabled={blocker === "pending"}>
            {phase.kind === "error" ? t("admin.retry") : t("admin.register")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 9: Add the server shell page**

`src/app/admin/agent/page.tsx`:

```tsx
import type { Metadata } from "next";
import { WalletProviders } from "@/components/providers/wallet-providers";
import { t } from "@/i18n";
import { readPublicEnv } from "@/lib/config/public";
import { AgentAdmin } from "./agent-admin";

export const metadata: Metadata = {
  title: `${t("admin.title")} · ${t("app.name")}`,
  robots: { index: false, follow: false },
};

export default function AgentAdminPage() {
  const env = readPublicEnv();
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 items-start justify-center px-4 py-12 md:px-8">
      <WalletProviders>
        <AgentAdmin
          appUrl={env.NEXT_PUBLIC_APP_URL}
          attributionCode={env.NEXT_PUBLIC_ATTRIBUTION_CODE}
          agentWallet={env.NEXT_PUBLIC_AGENT_WALLET}
          agentId={env.NEXT_PUBLIC_AGENT_ID}
        />
      </WalletProviders>
    </main>
  );
}
```

- [ ] **Step 10: Add a reusable tag-verification script**

`scripts/verify-tx.ts`:

```ts
import { verifyTx } from "@celo/attribution-tags";
import type { Hex } from "viem";
import { createCeloPublicClient } from "@/lib/chain/clients";

const hash = process.argv[2];
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
  console.error("usage: npx tsx scripts/verify-tx.ts <0x transaction hash>");
  process.exit(1);
}
const client = createCeloPublicClient(process.env.CELO_RPC_URL ?? "https://forno.celo.org");
const decoded = await verifyTx({ client, hash: hash as Hex });
console.log(decoded ?? "no attribution tag in this transaction");
```

- [ ] **Step 11: Verify it builds**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass, and the route table lists `/admin/agent`. If TypeScript rejects `dataSuffix` or a wagmi hook name, check `node_modules/wagmi/dist/types/hooks/` for the 3.7.7 signatures and adjust the call. Do not drop `dataSuffix`.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json src/lib/identity/admin-state.ts src/lib/identity/admin-state.test.ts src/lib/wallet src/components/providers src/app/admin src/i18n/en.ts scripts/verify-tx.ts
git commit -m "feat(admin): add agent wallet page to register Cobro's ERC-8004 identity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 13: User registers the identity on mainnet (first tagged transaction)**

Ask the user to do this themselves, because it spends real CELO from their wallet:
1. `npm run dev`, then open http://localhost:3000/admin/agent in the browser where `0x64ad…ae78` lives.
2. Connect wallet, then Switch to Celo if asked, then Register Cobro identity, then confirm in the wallet (gas in CELO, a fraction of a cent).
3. Wait for "Registered as agent #N" **and** "Attribution tag found". If the page says the tag is missing, stop and debug before sending any other transaction.
4. Send the agent id and the transaction hash to the assistant.

- [ ] **Step 14: Verify on-chain and publish the agent id**

```bash
npx tsx scripts/verify-tx.ts 0x<hash from the user>
```

Expected: `{ codes: [ 'celo_bc3965e128ba' ], schemaId: 0 }`.

Then:
1. Set `NEXT_PUBLIC_AGENT_ID=<N>` in `.env.local` and in Vercel (Production and Preview), and redeploy.
2. Check `curl -s "$APP_URL/agent-card.json"`: `registrations` must equal `[{"agentId": N, "agentRegistry": "eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"}]`.
3. The user opens https://www.loops.house/agents-on-open-rails/playground/submit and presses **Find it** in the Celo checklist.
4. Run `npx --yes loopshouse@0.6.0 project get --event agents-on-open-rails` and confirm `firstTaggedTx` is no longer `null`.

---

### Task 8: Operator wallet: key generation and tagged self-test with stablecoin gas

**Files:**
- Create: `scripts/lib/env-file.ts`, `scripts/lib/env-file.test.ts`, `scripts/operator-keygen.ts`, `scripts/operator-selftest.ts`

**Interfaces:**
- Consumes: `parseServerEnv`, `requireValue`, `readPublicEnv` (Task 3); `createCeloPublicClient`, `createOperatorClient`, `operatorSendParams` (Task 4); `TOKENS` (Task 2).
- Produces: `upsertEnvLine(content: string, key: string, value: string): string`, which throws if `key` already holds a non-empty value. It also produces a funded operator key in `.env.local` and one tagged mainnet transaction from the operator.

- [ ] **Step 1: Write the failing test**

`scripts/lib/env-file.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { upsertEnvLine } from "./env-file";

describe("upsertEnvLine", () => {
  it("fills an empty KEY= line in place", () => {
    expect(upsertEnvLine("A=1\nOPERATOR_PRIVATE_KEY=\nB=2\n", "OPERATOR_PRIVATE_KEY", "0xabc")).toBe(
      "A=1\nOPERATOR_PRIVATE_KEY=0xabc\nB=2\n",
    );
  });

  it("appends the line when the key is absent", () => {
    expect(upsertEnvLine("A=1", "OPERATOR_PRIVATE_KEY", "0xabc")).toBe("A=1\nOPERATOR_PRIVATE_KEY=0xabc\n");
    expect(upsertEnvLine("", "OPERATOR_PRIVATE_KEY", "0xabc")).toBe("OPERATOR_PRIVATE_KEY=0xabc\n");
  });

  it("refuses to overwrite an existing value", () => {
    expect(() => upsertEnvLine("OPERATOR_PRIVATE_KEY=0xdef\n", "OPERATOR_PRIVATE_KEY", "0xabc")).toThrow(
      /already set/,
    );
  });

  it("does not match a key that merely shares a prefix", () => {
    expect(upsertEnvLine("OPERATOR_PRIVATE_KEY_OLD=x\n", "OPERATOR_PRIVATE_KEY", "0xabc")).toBe(
      "OPERATOR_PRIVATE_KEY_OLD=x\nOPERATOR_PRIVATE_KEY=0xabc\n",
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- scripts/lib`
Expected: FAIL, `Failed to resolve import "./env-file"`.

- [ ] **Step 3: Implement `upsertEnvLine`**

`scripts/lib/env-file.ts`:

```ts
export function upsertEnvLine(content: string, key: string, value: string): string {
  const linePattern = new RegExp(`^${key}=(.*)$`, "m");
  const match = content.match(linePattern);
  if (match) {
    if (match[1].trim() !== "") throw new Error(`${key} is already set; refusing to overwrite it`);
    return content.replace(linePattern, `${key}=${value}`);
  }
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${key}=${value}\n`;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npm test -- scripts/lib`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the key-generation script**

It never prints the key; only the address is shown.

`scripts/operator-keygen.ts`:

```ts
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { upsertEnvLine } from "./lib/env-file";

const ENV_FILE = ".env.local";
const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const privateKey = generatePrivateKey();
writeFileSync(ENV_FILE, upsertEnvLine(current, "OPERATOR_PRIVATE_KEY", privateKey));
chmodSync(ENV_FILE, 0o600);
console.log(`Operator address: ${privateKeyToAccount(privateKey).address}`);
console.log(`The private key was written to ${ENV_FILE} and is not shown here.`);
```

- [ ] **Step 6: Add the self-test script**

`scripts/operator-selftest.ts`:

```ts
import { verifyTx } from "@celo/attribution-tags";
import { erc20Abi, formatUnits } from "viem";
import { createCeloPublicClient, createOperatorClient, operatorSendParams } from "@/lib/chain/clients";
import { TOKENS } from "@/lib/chain/tokens";
import { readPublicEnv } from "@/lib/config/public";
import { parseServerEnv, requireValue } from "@/lib/config/server";

const server = parseServerEnv();
const pub = readPublicEnv();
const feeToken = server.OPERATOR_FEE_TOKEN;
const code = pub.NEXT_PUBLIC_ATTRIBUTION_CODE;

const publicClient = createCeloPublicClient(server.CELO_RPC_URL);
const operator = createOperatorClient({
  privateKey: requireValue(server.OPERATOR_PRIVATE_KEY, "OPERATOR_PRIVATE_KEY"),
  attributionCode: code,
  rpcUrl: server.CELO_RPC_URL,
});
const address = operator.account.address;

const balance =
  feeToken === "CELO"
    ? await publicClient.getBalance({ address })
    : await publicClient.readContract({
        address: TOKENS[feeToken].address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
const decimals = feeToken === "CELO" ? 18 : TOKENS[feeToken].decimals;
console.log(`Operator ${address} holds ${formatUnits(balance, decimals)} ${feeToken}`);
if (balance === 0n) {
  console.error(`Fund ${address} with a little ${feeToken} on Celo mainnet, then run this again.`);
  process.exit(2);
}

const hash = await operator.sendTransaction({ to: address, value: 0n, ...operatorSendParams(feeToken) });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const decoded = await verifyTx({ client: publicClient, hash });
console.log(`status: ${receipt.status}`);
console.log(`codes: ${decoded?.codes.join(", ") ?? "none"}`);
console.log(`https://celoscan.io/tx/${hash}`);
if (receipt.status !== "success" || !decoded?.codes.includes(code)) process.exit(1);
```

- [ ] **Step 7: Type-check and commit**

```bash
npm run typecheck
git add scripts/lib scripts/operator-keygen.ts scripts/operator-selftest.ts
git commit -m "feat(scripts): add operator key generation and tagged self-test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Generate the key**

Run: `npx tsx scripts/operator-keygen.ts`
Expected: `Operator address: 0x…`. Check `git status --short` shows no `.env.local`.

- [ ] **Step 9: User funds the operator wallet**

Ask the user to send, from `0x64ad…ae78`, about **0.5 of the gas stablecoin** to the operator address. The agent wallet currently holds about 0.91 USDC and no USDT. In that case set `OPERATOR_FEE_TOKEN=USDC` in `.env.local` and send 0.5 USDC. USDC is still a stablecoin, so gas is still paid in stablecoins. Switch back to USDT once the treasury holds USDT in Plan 3.

- [ ] **Step 10: Run the mainnet self-test**

Run: `npx tsx --env-file=.env.local scripts/operator-selftest.ts`
Expected: `status: success`, `codes: celo_bc3965e128ba`, and a Celoscan link. On Celoscan, the transaction type is 123 (CIP-64) and the fee is charged in the chosen token.

---

### Task 9: Para REST signer client and live spike

**Files:**
- Create: `src/lib/signer/signature.ts`, `src/lib/signer/signature.test.ts`, `src/lib/signer/para-rest.ts`, `src/lib/signer/para-rest.test.ts`, `scripts/spike/para-rest.ts`

**Interfaces:**
- Consumes: `parseServerEnv`, `requireValue`, `readPublicEnv` (Task 3); `createCeloPublicClient` (Task 4); `attributionSuffix` (Task 2); `TOKENS` (Task 2).
- Produces:
  - `withHexPrefix(value: string): Hex`
  - `rawSignatureToParts(signature: string): { r: Hex; s: Hex; yParity: 0 | 1 }`
  - `toJsonSafe<T>(value: T): unknown`, which turns bigint into a decimal string recursively
  - `class ParaRestClient` with `createWallet(userId)`, `getWallet(id)`, `waitUntilReady(id, opts?)`, `signTransaction(id, tx, idempotencyKey?)`, `signTypedData(id, typedData)` and `signRaw(id, data)`. The three sign methods return `Promise<Hex>`, 0x-prefixed.
  - `class ParaRestError extends Error { status: number; code?: string }`
  - `interface ParaWallet { id; type; status: "creating" | "ready"; address?: Address }`, `interface ParaEvmTransaction`, `interface ParaTypedData`

- [ ] **Step 1: Write the failing signature tests**

`src/lib/signer/signature.test.ts`:

```ts
import { keccak256, recoverAddress, serializeSignature, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { rawSignatureToParts, toJsonSafe, withHexPrefix } from "./signature";

const r = `0x${"aa".repeat(32)}` as const;
const s = `0x${"bb".repeat(32)}` as const;

describe("withHexPrefix", () => {
  it("adds 0x only when missing", () => {
    expect(withHexPrefix("abcd")).toBe("0xabcd");
    expect(withHexPrefix("0xabcd")).toBe("0xabcd");
  });
});

describe("rawSignatureToParts", () => {
  it.each([
    ["1b", 0],
    ["1c", 1],
    ["00", 0],
    ["01", 1],
  ])("maps recovery byte %s to yParity %i, with or without 0x", (v, yParity) => {
    const unprefixed = `${r.slice(2)}${s.slice(2)}${v}`;
    expect(rawSignatureToParts(unprefixed)).toEqual({ r, s, yParity });
    expect(rawSignatureToParts(`0x${unprefixed}`)).toEqual({ r, s, yParity });
  });

  it("rejects other recovery bytes and wrong lengths", () => {
    expect(() => rawSignatureToParts(`${r.slice(2)}${s.slice(2)}05`)).toThrow(/recovery byte/);
    expect(() => rawSignatureToParts(`${r.slice(2)}${s.slice(2)}`)).toThrow(/65-byte/);
  });

  it("round-trips a real secp256k1 signature", async () => {
    const privateKey = generatePrivateKey();
    const hash = keccak256(toHex("cobro"));
    const signature = await sign({ hash, privateKey, to: "hex" });
    const parts = rawSignatureToParts(signature);
    const recovered = await recoverAddress({ hash, signature: serializeSignature(parts) });
    expect(recovered).toBe(privateKeyToAccount(privateKey).address);
  });
});

describe("toJsonSafe", () => {
  it("turns bigints into decimal strings, deeply", () => {
    expect(toJsonSafe({ a: 1n, b: [2n, { c: 3n }], d: "x" })).toEqual({ a: "1", b: ["2", { c: "3" }], d: "x" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- src/lib/signer/signature`
Expected: FAIL, `Failed to resolve import "./signature"`.

- [ ] **Step 3: Implement `signature.ts`**

```ts
import type { Hex } from "viem";

export function withHexPrefix(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

/** Para returns 65-byte r||s||v signatures without 0x; v may be 0/1 or 27/28. */
export function rawSignatureToParts(signature: string): { r: Hex; s: Hex; yParity: 0 | 1 } {
  const hex = withHexPrefix(signature);
  if (hex.length !== 132) {
    throw new Error(`Expected a 65-byte signature, got ${(hex.length - 2) / 2} bytes`);
  }
  const v = Number.parseInt(hex.slice(130, 132), 16);
  let yParity: 0 | 1;
  if (v === 0 || v === 27) yParity = 0;
  else if (v === 1 || v === 28) yParity = 1;
  else throw new Error(`Unexpected recovery byte ${v}`);
  return { r: `0x${hex.slice(2, 66)}` as Hex, s: `0x${hex.slice(66, 130)}` as Hex, yParity };
}

/** JSON cannot carry bigint; Para accepts uint values as decimal strings. */
export function toJsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]));
  }
  return value;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm test -- src/lib/signer/signature`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing client tests**

`src/lib/signer/para-rest.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ParaRestClient, ParaRestError } from "./para-rest";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function clientWith(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  const client = new ParaRestClient({ apiKey: "sk_test", baseUrl: "https://api.beta.getpara.com", fetch: fetchMock });
  return { client, fetchMock };
}

describe("ParaRestClient", () => {
  it("creates an EVM wallet keyed by a custom id", async () => {
    const { client, fetchMock } = clientWith(
      jsonResponse(201, { id: "w1", type: "EVM", status: "creating", address: "0x9dd3824f045c77bc369485e8f1dd6b452b6be617" }),
    );
    const wallet = await client.createWallet("user-42");
    expect(wallet.id).toBe("w1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.beta.getpara.com/v1/wallets");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ type: "EVM", userIdentifier: "user-42", userIdentifierType: "CUSTOM_ID" });
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("sk_test");
    expect(headers["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("polls until the wallet is ready", async () => {
    const { client, fetchMock } = clientWith(
      jsonResponse(200, { id: "w1", type: "EVM", status: "creating" }),
      jsonResponse(200, { id: "w1", type: "EVM", status: "ready", address: "0x9dd3824f045c77bc369485e8f1dd6b452b6be617" }),
    );
    const wallet = await client.waitUntilReady("w1", { intervalMs: 0, timeoutMs: 1000 });
    expect(wallet.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(200, { id: "w1", type: "EVM", status: "creating" }));
    const client = new ParaRestClient({ apiKey: "k", baseUrl: "https://x", fetch: fetchMock });
    await expect(client.waitUntilReady("w1", { intervalMs: 1, timeoutMs: 5 })).rejects.toThrow(/not ready/);
  });

  it("returns a 0x-prefixed signed transaction and forwards the idempotency key", async () => {
    const { client, fetchMock } = clientWith(jsonResponse(200, { signedTransaction: "0x02f8aa" }));
    const signed = await client.signTransaction("w1", { to: "0x000000000000000000000000000000000000dEaD", chainId: 42220, type: 2, value: "0" }, "idem-1");
    expect(signed).toBe("0x02f8aa");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.beta.getpara.com/v1/wallets/w1/sign-transaction");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("idem-1");
    expect(JSON.parse(String(init?.body)).transaction.chainId).toBe(42220);
  });

  it("prefixes typed-data and raw signatures returned without 0x", async () => {
    const { client } = clientWith(jsonResponse(200, { signature: "abcd" }), jsonResponse(200, { signature: "ef01" }));
    expect(await client.signTypedData("w1", { domain: {}, types: {}, primaryType: "X", message: {} })).toBe("0xabcd");
    expect(await client.signRaw("w1", "0x1234")).toBe("0xef01");
  });

  it("surfaces policy denials with their code", async () => {
    const { client } = clientWith(
      jsonResponse(403, { code: "POLICY_DENIED", message: "Transaction denied by policy" }),
    );
    const error = await client
      .signTransaction("w1", { to: "0x000000000000000000000000000000000000dEaD", chainId: 42220, type: 2 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ParaRestError);
    expect((error as ParaRestError).status).toBe(403);
    expect((error as ParaRestError).code).toBe("POLICY_DENIED");
  });

  it("handles a non-JSON error body", async () => {
    const { client } = clientWith(new Response("Bad Gateway", { status: 502 }));
    await expect(client.getWallet("w1")).rejects.toThrow(/502.*Bad Gateway/);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npm test -- src/lib/signer/para-rest`
Expected: FAIL, `Failed to resolve import "./para-rest"`.

- [ ] **Step 7: Implement `para-rest.ts`**

Request and response shapes come from `https://docs.getpara.com/openapi.yaml` (checked 2026-10-08).

```ts
import type { Address, Hex } from "viem";
import { withHexPrefix } from "./signature";

export interface ParaWallet {
  id: string;
  type: string;
  status: "creating" | "ready";
  address?: Address;
  publicKey?: string;
  userIdentifier?: string;
  userIdentifierType?: string;
}

/** Para's EvmTransaction: only legacy (0) and EIP-1559 (2); numbers as decimal or 0x strings. */
export interface ParaEvmTransaction {
  to: Address;
  chainId: number;
  type: 0 | 2;
  value?: string;
  data?: Hex;
  nonce?: number;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

/** EIP-712 typed data without EIP712Domain in `types`; values must be JSON-safe (see toJsonSafe). */
export interface ParaTypedData {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export class ParaRestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ParaRestError";
  }
}

export interface ParaRestClientOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
}

export class ParaRestClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ParaRestClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  createWallet(userId: string): Promise<ParaWallet> {
    return this.request<ParaWallet>("POST", "/v1/wallets", {
      type: "EVM",
      userIdentifier: userId,
      userIdentifierType: "CUSTOM_ID",
    });
  }

  getWallet(walletId: string): Promise<ParaWallet> {
    return this.request<ParaWallet>("GET", `/v1/wallets/${encodeURIComponent(walletId)}`);
  }

  async waitUntilReady(walletId: string, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<ParaWallet> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const intervalMs = opts.intervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const wallet = await this.getWallet(walletId);
      if (wallet.status === "ready" && wallet.address) return wallet;
      if (Date.now() >= deadline) throw new Error(`Para wallet ${walletId} not ready after ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async signTransaction(walletId: string, transaction: ParaEvmTransaction, idempotencyKey?: string): Promise<Hex> {
    const result = await this.request<{ signedTransaction: string }>(
      "POST",
      `/v1/wallets/${encodeURIComponent(walletId)}/sign-transaction`,
      { transaction },
      idempotencyKey,
    );
    return withHexPrefix(result.signedTransaction);
  }

  async signTypedData(walletId: string, typedData: ParaTypedData): Promise<Hex> {
    const result = await this.request<{ signature: string }>(
      "POST",
      `/v1/wallets/${encodeURIComponent(walletId)}/sign-typed-data`,
      { typedData },
    );
    return withHexPrefix(result.signature);
  }

  async signRaw(walletId: string, data: Hex): Promise<Hex> {
    const result = await this.request<{ signature: string }>(
      "POST",
      `/v1/wallets/${encodeURIComponent(walletId)}/sign-raw`,
      { data },
    );
    return withHexPrefix(result.signature);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      "X-API-Key": this.options.apiKey,
      "X-Request-Id": crypto.randomUUID(),
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: { code?: string; message?: string } | undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      throw new ParaRestError(
        response.status,
        json?.code,
        `Para ${method} ${path} failed with ${response.status}: ${json?.message ?? text}`,
      );
    }
    return json as T;
  }
}
```

- [ ] **Step 8: Run all signer tests to see them pass**

Run: `npm test -- src/lib/signer`
Expected: PASS (15 tests).

- [ ] **Step 9: Commit the client**

```bash
git add src/lib/signer
git commit -m "feat(signer): add Para REST client and signature normalisation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Write the live spike script**

`scripts/spike/para-rest.ts` runs checks 1–3 and 5 by default. Check 4 runs with `SPIKE_GUARDRAIL=1` after the user creates a Guardrail. Reuse a wallet with `SPIKE_WALLET_ID`.

```ts
import { verifyTx } from "@celo/attribution-tags";
import { randomBytes, randomUUID } from "node:crypto";
import {
  encodeFunctionData,
  erc20Abi,
  isAddressEqual,
  keccak256,
  recoverAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  serializeSignature,
  toHex,
  type Address,
} from "viem";
import { serializeTransaction } from "viem/celo";
import { attributionSuffix } from "@/lib/chain/attribution";
import { createCeloPublicClient } from "@/lib/chain/clients";
import { TOKENS } from "@/lib/chain/tokens";
import { readPublicEnv } from "@/lib/config/public";
import { parseServerEnv, requireValue } from "@/lib/config/server";
import { ParaRestClient, ParaRestError } from "@/lib/signer/para-rest";
import { rawSignatureToParts, toJsonSafe } from "@/lib/signer/signature";

const server = parseServerEnv();
const code = readPublicEnv().NEXT_PUBLIC_ATTRIBUTION_CODE;
const para = new ParaRestClient({
  apiKey: requireValue(server.PARA_API_KEY, "PARA_API_KEY"),
  baseUrl: server.PARA_REST_BASE_URL,
});
const publicClient = createCeloPublicClient(server.CELO_RPC_URL);
const results: { check: string; pass: boolean; detail: string }[] = [];
const record = (check: string, pass: boolean, detail: string) => {
  results.push({ check, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${check}  ${detail}`);
};

// 1. App-owned wallet keyed by CUSTOM_ID
const walletId = process.env.SPIKE_WALLET_ID ?? (await para.createWallet(`cobro-spike-${Date.now()}`)).id;
const wallet = await para.waitUntilReady(walletId);
const address = wallet.address as Address;
record("create-wallet", true, `${wallet.id} ${address}`);

// 2. EIP-712 Textile TakerControl
const typedData = {
  domain: { name: "Textile Taker Control", version: "1", chainId: 42220 },
  types: {
    TakerControl: [
      { name: "taker", type: "address" },
      { name: "chainId", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "issuedAt", type: "uint256" },
    ],
  },
  primaryType: "TakerControl",
  message: { taker: address, chainId: 42220n, nonce: toHex(randomBytes(32)), issuedAt: BigInt(Date.now()) },
} as const;
const typedSignature = await para.signTypedData(wallet.id, toJsonSafe(typedData) as Parameters<typeof para.signTypedData>[1]);
const typedSigner = await recoverTypedDataAddress({ ...typedData, signature: typedSignature });
record("sign-typed-data", isAddressEqual(typedSigner, address), `recovered ${typedSigner}`);

// 3. EIP-1559 transaction with our tag, broadcast by us
const balance = await publicClient.getBalance({ address });
if (balance === 0n) {
  console.log(`\nFund ${address} with 0.02 CELO, then re-run with SPIKE_WALLET_ID=${wallet.id}`);
  process.exit(2);
}
const nonce = await publicClient.getTransactionCount({ address });
const fees = await publicClient.estimateFeesPerGas();
const tagData = attributionSuffix(code);
const gas = await publicClient.estimateGas({ account: address, to: address, data: tagData, value: 0n });
const signedTx = await para.signTransaction(
  wallet.id,
  {
    to: address,
    chainId: 42220,
    type: 2,
    value: "0",
    data: tagData,
    nonce,
    gasLimit: gas.toString(),
    maxFeePerGas: fees.maxFeePerGas.toString(),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
  },
  randomUUID(),
);
const txSigner = await recoverTransactionAddress({ serializedTransaction: signedTx as `0x02${string}` });
record("sign-transaction", isAddressEqual(txSigner, address), `recovered ${txSigner}`);
const hash = await publicClient.sendRawTransaction({ serializedTransaction: signedTx });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const decoded = await verifyTx({ client: publicClient, hash });
record(
  "broadcast-tagged",
  receipt.status === "success" && (decoded?.codes.includes(code) ?? false),
  `https://celoscan.io/tx/${hash}`,
);

// 4. Guardrail (run after creating it in the Para Developer Portal)
if (process.env.SPIKE_GUARDRAIL === "1") {
  const outsideCall = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: ["0x000000000000000000000000000000000000dEaD", 1n],
  });
  try {
    await para.signTransaction(wallet.id, {
      to: TOKENS.USDT.address,
      chainId: 42220,
      type: 2,
      value: "0",
      data: outsideCall,
      nonce: nonce + 1,
      gasLimit: "100000",
      maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    });
    record("guardrail-blocks", false, "approve(dEaD) was signed: no active Guardrail covered it");
  } catch (error) {
    const denied = error instanceof ParaRestError && error.code === "POLICY_DENIED";
    record("guardrail-blocks", denied, error instanceof Error ? error.message : String(error));
  }
}

// 5. CIP-64 (USDT gas) via sign-raw. Not broadcast: the spike wallet holds no USDT.
const cip64 = {
  type: "cip64" as const,
  chainId: 42220,
  to: address,
  data: tagData,
  value: 0n,
  nonce: nonce + 1,
  gas: 80_000n,
  maxFeePerGas: fees.maxFeePerGas,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  feeCurrency: TOKENS.USDT.feeCurrency,
};
const digest = keccak256(serializeTransaction(cip64));
const parts = rawSignatureToParts(await para.signRaw(wallet.id, digest));
const cip64Signer = await recoverAddress({ hash: digest, signature: serializeSignature(parts) });
record("sign-raw-cip64", isAddressEqual(cip64Signer, address), `recovered ${cip64Signer} (sign-raw bypasses Guardrails)`);

console.log("\nRESULTS");
console.table(results);
```

- [ ] **Step 11: Type-check and commit the script**

```bash
npm run typecheck
git add scripts/spike/para-rest.ts
git commit -m "chore(spike): add live Para REST feasibility checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 12: User creates the Para developer account and secret key**

Ask the user to:
1. Sign up at https://developer.getpara.com and create a project named "Cobro".
2. Create a **Beta** API key pair. Put the secret REST key in `.env.local` as `PARA_API_KEY=` and the public client key as `NEXT_PUBLIC_PARA_API_KEY=`. Do not paste either key into the chat.
3. Under authentication, enable email sign-in, which Task 10 needs.

- [ ] **Step 13: Run checks 1–3 and 5 on mainnet**

```bash
npx tsx --env-file=.env.local scripts/spike/para-rest.ts
```

The first run creates the wallet and exits with code 2, asking for 0.02 CELO. The user sends it from `0x64ad…ae78`. Re-run with `SPIKE_WALLET_ID=<id> npx tsx --env-file=.env.local scripts/spike/para-rest.ts`. Save the printed RESULTS table for Task 11.

- [ ] **Step 14: User adds a Guardrail and runs check 4**

Ask the user to create, in the Para Developer Portal under Permissions, then Guardrails, then Add:
- Networks: Celo (42220). Record whether Celo is offered at all.
- Action "Call a contract": contract `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` (USDT), function `approve`, condition `spender == 0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`. Then activate it.

Then run: `SPIKE_GUARDRAIL=1 SPIKE_WALLET_ID=<id> npx tsx --env-file=.env.local scripts/spike/para-rest.ts`
Expected outcome for a pass: `guardrail-blocks` PASS with `POLICY_DENIED`. Record the outcome either way.

---

### Task 10: Para sign-in spike with server-side JWT verification

**Files:**
- Create: `src/lib/auth/para-jwt.ts`, `src/lib/auth/para-jwt.test.ts`, `src/app/api/spike/para-verify/route.ts`, `src/app/spike/para-login/page.tsx`, `src/app/spike/para-login/para-login.tsx`, `src/app/spike/para-login/para-provider.tsx`
- Modify: `package.json` (dependencies and the `postinstall` that `setup-para` needs), `src/i18n/en.ts`

**Interfaces:**
- Consumes: `parseServerEnv` (Task 3), `t` (Task 1).
- Produces:
  - `interface ParaSession { paraUserId: string; email?: string; evmAddress?: Address; expiresAt: number }`
  - `verifyParaJwt(token: string, getKey: JWTVerifyGetKey): Promise<ParaSession>`
  - `paraJwks(url: string): JWTVerifyGetKey`
  - `POST /api/spike/para-verify` with body `{ token }`, returning `{ session }` or `{ error }` with 400 or 401
  - Page `/spike/para-login`

- [ ] **Step 1: Install jose and write the failing JWT tests**

```bash
npm install jose@6.2.12
```

`src/lib/auth/para-jwt.test.ts`:

```ts
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyParaJwt } from "./para-jwt";

let jwks: ReturnType<typeof createLocalJWKSet>;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const other = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256" }] });
});

function token(payload: JWTPayload, key = privateKey, expires: string | number | null = "10m") {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg: "ES256", kid: "k1" }).setSubject("user-1").setIssuedAt();
  if (expires !== null) jwt.setExpirationTime(expires);
  return jwt.sign(key);
}

const data = {
  userId: "user-1",
  email: "freelancer@example.com",
  wallets: [
    { id: "w-sol", type: "SOLANA", address: "EEp7DbBu5yvgf7Pr9W17cATPjCqUxY8K8R3dFbg53a3W" },
    { id: "w-evm", type: "EVM", address: "0x9dd3824f045c77bc369485e8f1dd6b452b6be617" },
  ],
};

describe("verifyParaJwt", () => {
  it("returns the user, email and checksummed EVM address", async () => {
    const session = await verifyParaJwt(await token({ data }), jwks);
    expect(session.paraUserId).toBe("user-1");
    expect(session.email).toBe("freelancer@example.com");
    expect(session.evmAddress).toBe("0x9DD3824f045c77bc369485e8f1DD6b452b6BE617");
    expect(session.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it("rejects an expired token", async () => {
    await expect(verifyParaJwt(await token({ data }, privateKey, Math.floor(Date.now() / 1000) - 60), jwks)).rejects.toThrow();
  });

  it("rejects a token signed by another key", async () => {
    await expect(verifyParaJwt(await token({ data }, otherPrivateKey), jwks)).rejects.toThrow();
  });

  it("rejects a token without an expiry", async () => {
    await expect(verifyParaJwt(await token({ data }, privateKey, null), jwks)).rejects.toThrow(/expiry/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- src/lib/auth`
Expected: FAIL, `Failed to resolve import "./para-jwt"`.

- [ ] **Step 3: Implement `para-jwt.ts`**

JWKS URLs and the payload shape come from https://docs.getpara.com/v3/react/guides/sessions-jwt.md.

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { getAddress, type Address } from "viem";

export interface ParaSession {
  paraUserId: string;
  email?: string;
  evmAddress?: Address;
  expiresAt: number;
}

interface ParaJwtData {
  userId?: string;
  email?: string;
  wallets?: { type?: string; address?: string }[];
}

export function paraJwks(url: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(url));
}

export async function verifyParaJwt(token: string, getKey: JWTVerifyGetKey): Promise<ParaSession> {
  const { payload } = await jwtVerify(token, getKey);
  if (payload.exp === undefined) throw new Error("Para token has no expiry");
  const data = (payload.data ?? {}) as ParaJwtData;
  const paraUserId = data.userId ?? payload.sub;
  if (!paraUserId) throw new Error("Para token has no user id");
  const evmWallet = data.wallets?.find((wallet) => wallet.type === "EVM" && wallet.address);
  return {
    paraUserId,
    email: data.email,
    evmAddress: evmWallet?.address ? getAddress(evmWallet.address) : undefined,
    expiresAt: payload.exp,
  };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npm test -- src/lib/auth`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the verification route**

`src/app/api/spike/para-verify/route.ts`:

```ts
import { paraJwks, verifyParaJwt } from "@/lib/auth/para-jwt";
import { parseServerEnv } from "@/lib/config/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string") {
    return Response.json({ error: "token is required" }, { status: 400 });
  }
  try {
    const session = await verifyParaJwt(body.token, paraJwks(parseServerEnv().PARA_JWKS_URL));
    return Response.json({ session });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid token" }, { status: 401 });
  }
}
```

- [ ] **Step 6: Commit the verifier**

```bash
git add package.json package-lock.json src/lib/auth src/app/api/spike
git commit -m "feat(auth): verify Para session JWTs against Para's JWKS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Install the Para React SDK**

```bash
npm install @getpara/react-sdk@3.21.0
npm pkg set scripts.postinstall="npx setup-para"
npm run postinstall
git diff --stat
```

Record in the spike notes which files `setup-para` changed (for example `next.config.ts`). Keep its changes unless `npm run build` breaks. If it targets webpack only and Turbopack fails in Step 10, note that and retry with `npx next dev --webpack`.

- [ ] **Step 8: Add the spike strings**

Add these entries to the `en` object in `src/i18n/en.ts`:

```ts
  "spike.title": "Para sign-in check",
  "spike.intro": "Sign in with email, then ask the server to verify the Para session token.",
  "spike.signIn": "Sign in with email",
  "spike.verify": "Verify session on the server",
  "spike.verified": "Server verified the session",
  "spike.failed": "Server rejected the session",
```

- [ ] **Step 9: Add the provider, client UI and page**

`src/app/spike/para-login/para-provider.tsx`:

```tsx
"use client";

import { Environment, ParaProvider } from "@getpara/react-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

const environment = process.env.NEXT_PUBLIC_PARA_ENVIRONMENT === "PROD" ? Environment.PROD : Environment.BETA;

export function ParaSpikeProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{ apiKey: process.env.NEXT_PUBLIC_PARA_API_KEY ?? "", env: environment }}
        config={{ appName: "Cobro" }}
        paraModalConfig={{
          disableEmailLogin: false,
          disablePhoneLogin: true,
          authLayout: ["AUTH:FULL"],
          oAuthMethods: [],
          recoverySecretStepEnabled: true,
          theme: {
            foregroundColor: "#0F172A",
            backgroundColor: "#FFFFFF",
            accentColor: "#0F766E",
            mode: "light",
            font: "IBM Plex Sans",
          },
        }}
      >
        {children}
      </ParaProvider>
    </QueryClientProvider>
  );
}
```

`src/app/spike/para-login/para-login.tsx`:

```tsx
"use client";

import { useAccount, useIssueJwt, useModal } from "@getpara/react-sdk";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

type Result = { ok: true; body: unknown } | { ok: false; body: unknown } | null;

export function ParaLoginSpike() {
  const { isConnected } = useAccount();
  const { openModal } = useModal();
  const { issueJwtAsync } = useIssueJwt();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function verify() {
    setPending(true);
    try {
      const { token } = await issueJwtAsync();
      const response = await fetch("/api/spike/para-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setResult({ ok: response.ok, body: await response.json() });
    } catch (error) {
      setResult({ ok: false, body: { error: error instanceof Error ? error.message : String(error) } });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!isConnected ? (
        <Button size="lg" className="min-h-11" onClick={() => openModal()}>
          {t("spike.signIn")}
        </Button>
      ) : (
        <Button size="lg" className="min-h-11" onClick={verify} disabled={pending}>
          {t("spike.verify")}
        </Button>
      )}
      <div aria-live="polite">
        {result && (
          <div className="flex flex-col gap-2">
            <p className={`flex items-center gap-2 font-medium ${result.ok ? "text-success" : "text-destructive"}`}>
              {result.ok ? <CircleCheck aria-hidden="true" className="size-5" /> : <CircleAlert aria-hidden="true" className="size-5" />}
              {result.ok ? t("spike.verified") : t("spike.failed")}
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{JSON.stringify(result.body, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
```

`src/app/spike/para-login/page.tsx`:

```tsx
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { ParaLoginSpike } from "./para-login";
import { ParaSpikeProvider } from "./para-provider";

export const metadata: Metadata = { title: t("spike.title"), robots: { index: false, follow: false } };

export default function ParaLoginSpikePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 items-start justify-center px-4 py-12 md:px-8">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold">{t("spike.title")}</CardTitle>
          <CardDescription>{t("spike.intro")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ParaSpikeProvider>
            <ParaLoginSpike />
          </ParaSpikeProvider>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 10: Build, then run the sign-in check with the user**

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run dev
```

If `typecheck` rejects a `paraModalConfig` field, read the type in `node_modules/@getpara/react-sdk` and remove only that field. If `npm run build` or `npm run dev` fails inside the Para SDK under Turbopack, record the error and retry with `npx next build --webpack` / `npx next dev --webpack`.

Ask the user to open http://localhost:3000/spike/para-login, sign in with their email, then press "Verify session on the server". Expected: "Server verified the session", with `paraUserId`, `email` and an `evmAddress` in the JSON. Record the result.

If the Para SDK cannot be made to build (neither Turbopack nor `--webpack`), record check 6 as FAIL with the error text. Do **not** commit the spike page, because it would break the production build. Undo it with `npm uninstall @getpara/react-sdk && npm pkg delete scripts.postinstall && git checkout -- next.config.ts src/i18n/en.ts && rm -rf src/app/spike`, and skip Step 11.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json next.config.ts src/app/spike src/i18n/en.ts
git commit -m "chore(spike): add Para email sign-in check with server-side verification

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Spike report and signer decision

**Files:**
- Create: `docs/superpowers/spikes/2026-10-11-para.md`
- Modify (only if the decision changes the design): `docs/superpowers/specs/2026-10-08-cobro-design.md` §8.4 and §13

**Interfaces:**
- Consumes: RESULTS from Task 9 Steps 13–14, and the Task 10 Step 10 outcome.
- Produces: the decision Plans 2–4 build on: `TreasurySigner` = Para REST or local key, and sign-in = Para or not.

- [ ] **Step 1: Write the report with the real outcomes**

`docs/superpowers/spikes/2026-10-11-para.md`. Fill every Result cell from the recorded runs, and paste the exact error text for any FAIL.

```markdown
# Para feasibility spike — results

Date: <run date> · Para environment: BETA · Package versions: @getpara/react-sdk 3.21.0, REST API per openapi.yaml (2026-10-08)

| # | Check (spec §13) | Result | Evidence |
|---|---|---|---|
| 1 | REST wallet creation with CUSTOM_ID | <PASS/FAIL> | wallet id, address |
| 2 | sign-typed-data (Textile TakerControl) recovers to the wallet | <PASS/FAIL> | recovered address |
| 3 | sign-transaction (EIP-1559, chain 42220) + tagged broadcast | <PASS/FAIL> | celoscan link, verifyTx codes |
| 4 | Guardrail on Celo denies approve(dEaD) | <PASS/FAIL/NOT AVAILABLE> | error code or "Celo not offered" |
| 5 | sign-raw signs a CIP-64 digest (USDT gas) | <PASS/FAIL> | recovered address |
| 6 | Email sign-in in Next.js 16.4 + JWT verified server-side | <PASS/FAIL> | session JSON (email redacted), Turbopack or --webpack |

## Decision

Treasury signer: <Para REST | local key>. Rule: Para REST if checks 1, 2, 3 pass; otherwise local key.
Guardrails: <enforced in Para + executor | executor only>. Rule: "Para + executor" only if check 4 passes.
Treasury gas: <CELO drip | USDT via sign-raw>. Rule: CELO drip unless check 5 passes AND the team accepts that sign-raw bypasses Guardrails.
Sign-in: <Para email | other>. Rule: Para if check 6 passes.

## Follow-ups for Plan 2
- <one line per concrete consequence, e.g. "TreasurySigner.para wraps ParaRestClient; Guardrail JSON stored in docs/">
```

- [ ] **Step 2: Update the spec only if a rule picked the fallback**

If any decision differs from the spec, edit §8.4 (Para) and §13 (spike) to state what was chosen and why, in one or two sentences each, citing the report path. Otherwise make no spec change.

- [ ] **Step 3: Commit and push**

```bash
git add docs/superpowers/spikes/2026-10-11-para.md docs/superpowers/specs/2026-10-08-cobro-design.md
git commit -m "docs: record Para spike results and treasury signer decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: Final verification of Plan 1**

```bash
npm test && npm run typecheck && npm run lint && npm run build
npx --yes loopshouse@0.6.0 project get --event agents-on-open-rails
```

Expected: everything passes, and `celo.firstTaggedTx` is set and `celo.hasIdentity: true`. Report to the user: the Cobro agent id, the first tagged tx link, the operator self-test tx link, and the signer decision.
