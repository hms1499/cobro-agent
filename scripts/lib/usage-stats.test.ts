import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { fxTrades, payments, treasuryTxs } from "@/lib/db/schema";
import { createTestDb, resetDb, seedFreelancer, seedInvoice } from "@/lib/db/testing";
import type { ReferenceRates } from "@/lib/fx/rates";
import { parseDecimal } from "@/lib/money/decimal";
import {
  computeUsage,
  loadUsageRows,
  renderUsageMarkdown,
  replaceUsageBlock,
  type Exclusions,
  type UsageRows,
} from "./usage-stats";
import type { WalletHistory } from "./wallet-history";

const NOW_RATES: ReferenceRates = { perUsd: { ARS: parseDecimal("1600", 18), BRL: parseDecimal("5", 18) }, fetchedAt: 0 };
const WINDOW = new Date("2026-10-06T12:00:00Z");
const BEFORE = new Date("2026-09-01T00:00:00Z");
const DURING = new Date("2026-10-20T00:00:00Z");

const CLIENT = "0xc11e000000000000000000000000000000000001";
const TEAM = "0x7ea0000000000000000000000000000000000002";
const OUTSIDE_FUNDER = "0xf00d000000000000000000000000000000000003";
const NO_EXCLUSIONS: Exclusions = { emails: [], wallets: [] };
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

type PaymentRow = UsageRows["payments"][number];

function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    freelancerId: "f1",
    payer: CLIENT,
    asset: "USAT",
    amountAtomic: 1_000_000n,
    txHash: hash(1),
    ratesSnapshot: null,
    settledAt: DURING,
    recurring: false,
    ...overrides,
  };
}

function rows(overrides: Partial<UsageRows> = {}): UsageRows {
  return { users: [], payments: [], swaps: [], withdrawals: [], ...overrides };
}

const independentHistory: WalletHistory = { firstActivityAt: BEFORE, firstFunder: OUTSIDE_FUNDER };
const histories = (entries: [string, WalletHistory | "error"][] = [[CLIENT, independentHistory]]) => new Map(entries);

describe("computeUsage", () => {
  it("counts a payer with activity before the window and an outside funder as independent", () => {
    const report = computeUsage(rows({ payments: [payment()] }), NO_EXCLUSIONS, histories(), NOW_RATES, WINDOW);
    expect(report.independentPayers).toBe(1);
    expect(report.payments).toBe(1);
    expect(report.paymentsByAsset.USAT).toBe(1);
    expect(report.volumeUsdCents).toBe(100);
    expect(report.activity[0].role).toBe("independent client");
  });

  it("a payer in the exclusion wallets is team, whatever the case of the address", () => {
    const upper = "0xAbC0000000000000000000000000000000000004";
    const report = computeUsage(
      rows({ payments: [payment({ payer: upper })] }),
      { emails: [], wallets: [upper.toLowerCase()] },
      histories([[upper.toLowerCase(), independentHistory]]),
      NOW_RATES,
      WINDOW,
    );
    expect(report.independentPayers).toBe(0);
    expect(report.payments).toBe(0);
    expect(report.activity[0].role).toBe("team");
  });

  it("a payer first funded by a team wallet is not independent", () => {
    const report = computeUsage(
      rows({ payments: [payment()] }),
      { emails: [], wallets: [TEAM] },
      histories([[CLIENT, { firstActivityAt: BEFORE, firstFunder: TEAM }]]),
      NOW_RATES,
      WINDOW,
    );
    expect(report.independentPayers).toBe(0);
    expect(report.activity[0].role).toBe("team");
  });

  it("a payer whose first activity is after the window start is not independent", () => {
    const report = computeUsage(
      rows({ payments: [payment()] }),
      NO_EXCLUSIONS,
      histories([[CLIENT, { firstActivityAt: new Date("2026-10-07T00:00:00Z"), firstFunder: OUTSIDE_FUNDER }]]),
      NOW_RATES,
      WINDOW,
    );
    expect(report.independentPayers).toBe(0);
    expect(report.activity[0].role).toBe("new wallet");
  });

  it('a payer with history "error" or null activity is unverified, not independent', () => {
    const other = "0xc11e000000000000000000000000000000000005";
    const report = computeUsage(
      rows({ payments: [payment(), payment({ payer: other, txHash: hash(2) })] }),
      NO_EXCLUSIONS,
      histories([
        [CLIENT, "error"],
        [other, { firstActivityAt: null, firstFunder: null }],
      ]),
      NOW_RATES,
      WINDOW,
    );
    expect(report.independentPayers).toBe(0);
    expect(report.unverifiedPayers).toBe(2);
    expect(report.activity.map((a) => a.role)).toEqual(["unverified", "unverified"]);
  });

  it("repeat payer needs two payments to the same freelancer", () => {
    const twoFreelancers = computeUsage(
      rows({ payments: [payment(), payment({ freelancerId: "f2", txHash: hash(2) })] }),
      NO_EXCLUSIONS,
      histories(),
      NOW_RATES,
      WINDOW,
    );
    expect(twoFreelancers.repeatPayers).toBe(0);

    const sameFreelancer = computeUsage(
      rows({ payments: [payment(), payment({ txHash: hash(2) })] }),
      NO_EXCLUSIONS,
      histories(),
      NOW_RATES,
      WINDOW,
    );
    expect(sameFreelancer.repeatPayers).toBe(1);
    expect(sameFreelancer.repeatUsatPayers).toBe(1);
  });

  it("prices a 1,600 wARS payment with snapshot ARS=1600 at 100 cents", () => {
    const wars = payment({ asset: "WARS", amountAtomic: parseDecimal("1600", 18), ratesSnapshot: { ARS: "1600", BRL: "5" } });
    const report = computeUsage(rows({ payments: [wars] }), NO_EXCLUSIONS, histories(), { ...NOW_RATES, perUsd: { ...NOW_RATES.perUsd, ARS: parseDecimal("3200", 18) } }, WINDOW);
    expect(report.volumeUsdCents).toBe(100);
    expect(report.todayRatePayments).toBe(0);
  });

  it("prices a local payment without a snapshot at today's rate and says so", () => {
    const wars = payment({ asset: "WARS", amountAtomic: parseDecimal("1600", 18), ratesSnapshot: null });
    const report = computeUsage(rows({ payments: [wars] }), NO_EXCLUSIONS, histories(), NOW_RATES, WINDOW);
    expect(report.volumeUsdCents).toBe(100);
    expect(report.todayRatePayments).toBe(1);
  });

  it("rows before the window are ignored", () => {
    const early = new Date("2026-10-09T00:00:00Z");
    const report = computeUsage(
      rows({
        payments: [payment({ settledAt: early })],
        swaps: [{ userId: "f1", txHash: hash(3), notionalUsdCents: 500, filledAt: early }],
        withdrawals: [{ userId: "f1", hash: hash(4), usdCents: 400, confirmedAt: early }],
      }),
      NO_EXCLUSIONS,
      histories(),
      NOW_RATES,
      new Date("2026-10-10T00:00:00Z"),
    );
    expect(report.payments).toBe(0);
    expect(report.swaps).toBe(0);
    expect(report.withdrawals).toBe(0);
    expect(report.activity).toEqual([]);
  });

  it("counts agent swaps and withdrawals in the window", () => {
    const report = computeUsage(
      rows({
        swaps: [{ userId: "f1", txHash: hash(3), notionalUsdCents: 500, filledAt: DURING }],
        withdrawals: [{ userId: "f1", hash: hash(4), usdCents: 400, confirmedAt: DURING }],
      }),
      NO_EXCLUSIONS,
      histories(),
      NOW_RATES,
      WINDOW,
    );
    expect(report.swaps).toBe(1);
    expect(report.swapVolumeUsdCents).toBe(500);
    expect(report.withdrawals).toBe(1);
    expect(report.activity.every((a) => a.role === "agent")).toBe(true);
  });

  it("swaps and withdrawals of team accounts are labelled team and not counted", () => {
    const report = computeUsage(
      rows({
        users: [{ id: "team-user", email: "team@example.com", createdAt: DURING }],
        swaps: [{ userId: "team-user", txHash: hash(3), notionalUsdCents: 500, filledAt: DURING }],
        withdrawals: [{ userId: "team-user", hash: hash(4), usdCents: 400, confirmedAt: DURING }],
      }),
      { emails: ["team@example.com"], wallets: [] },
      histories(),
      NOW_RATES,
      WINDOW,
    );
    expect(report.swaps).toBe(0);
    expect(report.swapVolumeUsdCents).toBe(0);
    expect(report.withdrawals).toBe(0);
    expect(report.activity.map((a) => a.role)).toEqual(["team", "team"]);
  });

  it("a user without an email is not counted as an outside freelancer", () => {
    const report = computeUsage(rows({ users: [{ id: "u0", email: null, createdAt: DURING }] }), NO_EXCLUSIONS, histories(), NOW_RATES, WINDOW);
    expect(report.outsideFreelancers).toBe(0);
  });

  it("outsideFreelancers excludes emails case-insensitively", () => {
    const report = computeUsage(
      rows({
        users: [
          { id: "u1", email: "Team@Example.com", createdAt: DURING },
          { id: "u2", email: "friend@example.org", createdAt: DURING },
        ],
      }),
      { emails: ["team@example.com"], wallets: [] },
      histories(),
      NOW_RATES,
      WINDOW,
    );
    expect(report.outsideFreelancers).toBe(1);
  });
});

describe("renderUsageMarkdown", () => {
  it("never contains an email or a bare address", () => {
    const report = computeUsage(
      rows({
        users: [{ id: "u2", email: "friend@example.org", createdAt: DURING }],
        payments: [payment(), payment({ payer: TEAM, txHash: hash(2) })],
        swaps: [{ userId: "f1", txHash: hash(3), notionalUsdCents: 500, filledAt: DURING }],
      }),
      { emails: [], wallets: [TEAM] },
      histories(),
      NOW_RATES,
      WINDOW,
    );
    const markdown = renderUsageMarkdown(report, new Date("2026-10-23T00:00:00Z"));
    expect(markdown).not.toContain("@");
    expect(markdown.replace(/https:\/\/celoscan\.io\/tx\/0x[0-9a-f]{64}/g, "")).not.toContain("0x");
    expect(markdown).toContain(`https://celoscan.io/tx/${hash(3)}`);
  });
});

describe("replaceUsageBlock", () => {
  const readme = "# Cobro\n\n<!-- usage:start -->\nold\n<!-- usage:end -->\n\nMore text\n";

  it("replaces only between markers", () => {
    expect(replaceUsageBlock(readme, "new")).toBe("# Cobro\n\n<!-- usage:start -->\nnew\n<!-- usage:end -->\n\nMore text\n");
  });

  it("throws when a marker is missing", () => {
    expect(() => replaceUsageBlock("# Cobro\n<!-- usage:start -->\n", "new")).toThrow("usage:end");
  });

  it("throws when markers appear twice", () => {
    expect(() => replaceUsageBlock(readme + readme, "new")).toThrow("exactly once");
  });
});

describe("loadUsageRows", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  it("keeps filled swaps and confirmed withdrawals only", async () => {
    const user = await seedFreelancer(db);
    const invoice = await seedInvoice(db, user.id);
    await db.insert(payments).values({ invoiceId: invoice.id, payer: CLIENT, asset: "USAT", amountAtomic: "1000000", txHash: hash(1), settledAt: DURING });
    await db.insert(fxTrades).values([
      { userId: user.id, sellAsset: "WARS", buyAsset: "USDT", sellAmount: "1", status: "filled", swapTxHash: hash(2), notionalUsdCents: 300, filledAt: DURING },
      { userId: user.id, sellAsset: "WARS", buyAsset: "USDT", sellAmount: "1", status: "no_quote" },
    ]);
    await db.insert(treasuryTxs).values([
      { userId: user.id, kind: "withdraw", nonce: 1, hash: hash(3), raw: "0x", feeToken: "USDT", status: "success", usdCents: 200, confirmedAt: DURING },
      { userId: user.id, kind: "withdraw", nonce: 2, hash: hash(4), raw: "0x", feeToken: "USDT", status: "pending" },
      { userId: user.id, kind: "swap", nonce: 3, hash: hash(5), raw: "0x", feeToken: "USDT", status: "success", confirmedAt: DURING },
    ]);

    const loaded = await loadUsageRows(db);

    expect(loaded.users.map((u) => u.id)).toEqual([user.id]);
    expect(loaded.payments).toEqual([
      expect.objectContaining({ freelancerId: user.id, payer: CLIENT, asset: "USAT", amountAtomic: 1_000_000n, txHash: hash(1), recurring: false }),
    ]);
    expect(loaded.swaps).toEqual([{ userId: user.id, txHash: hash(2), notionalUsdCents: 300, filledAt: DURING }]);
    expect(loaded.withdrawals).toEqual([{ userId: user.id, hash: hash(3), usdCents: 200, confirmedAt: DURING }]);
  });
});
