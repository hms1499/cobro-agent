import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const fiatCurrency = pgEnum("fiat_currency", ["USD", "ARS", "BRL"]);
export const localCurrency = pgEnum("local_currency", ["ARS", "BRL", "USD"]);
export const payAsset = pgEnum("pay_asset", ["USAT", "USDT", "WARS", "WBRL"]);
export const invoiceStatus = pgEnum("invoice_status", ["open", "settling", "paid", "cancelled"]);
export const recurringInterval = pgEnum("recurring_interval", ["weekly", "monthly"]);
export const walletStatus = pgEnum("wallet_status", ["creating", "ready", "failed", "retired"]);
export const signerType = pgEnum("signer_type", ["para", "local"]);
export const intentStatus = pgEnum("intent_status", ["proposed", "waiting", "executing", "filled", "blocked", "cancelled"]);
/** Trade approvals spec §2: what the agent may convert without asking the freelancer. */
export const approvalMode = pgEnum("approval_mode", ["auto", "sell_usd", "all"]);
export const intentReason = pgEnum("intent_reason", ["save_excess", "save_other", "top_up", "hub_route"]);
export const tradeStatus = pgEnum("trade_status", ["no_quote", "rejected", "expired", "broadcast", "filled", "failed"]);
export const txKind = pgEnum("tx_kind", ["approve", "swap", "withdraw"]);
/** `failed`: never mined — the node refused the bytes, or they were dropped (another nonce won, or unknown past the grace period). */
export const txStatus = pgEnum("tx_status", ["pending", "success", "reverted", "failed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Token amounts in atomic units (up to uint256), returned by drizzle as base-10 strings. */
const atomic = (name: string) => numeric(name, { precision: 78, scale: 0 });
/** Fiat amounts with cents, returned as strings such as "300.00". */
const fiatAmount = (name: string) => numeric(name, { precision: 20, scale: 2 });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  paraUserId: text("para_user_id").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  personalWallet: text("personal_wallet"),
  createdAt: createdAt(),
});

export const treasuryWallets = pgTable("treasury_wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  status: walletStatus("status").notNull().default("creating"),
  signerType: signerType("signer_type").notNull().default("para"),
  paraWalletId: text("para_wallet_id"),
  address: text("address"),
  gasDrippedAt: timestamp("gas_dripped_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rules = pgTable("rules", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  localCurrency: localCurrency("local_currency").notNull(),
  reserveAmount: fiatAmount("reserve_amount").notNull().default("0"),
  autoTopUp: boolean("auto_top_up").notNull().default(true),
  approvalMode: approvalMode("approval_mode").notNull().default("sell_usd"),
  maxSlippageBps: integer("max_slippage_bps").notNull().default(50),
  hardMaxSlippageBps: integer("hard_max_slippage_bps").notNull().default(150),
  maxWaitMinutes: integer("max_wait_minutes").notNull().default(360),
  perTradeMaxUsd: integer("per_trade_max_usd").notNull().default(50),
  dailyMaxUsd: integer("daily_max_usd").notNull().default(200),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientName: text("client_name").notNull(),
    description: text("description").notNull(),
    amount: fiatAmount("amount").notNull(),
    currency: fiatCurrency("currency").notNull(),
    interval: recurringInterval("interval").notNull(),
    /** Day of month (1–31) of the first issue; monthly invoices return to it when the month allows. */
    anchorDay: smallint("anchor_day").notNull(),
    nextIssueAt: timestamp("next_issue_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("recurring_due_idx").on(t.active, t.nextIssueAt)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recurringId: uuid("recurring_id").references(() => recurringInvoices.id, { onDelete: "set null" }),
    periodStart: timestamp("period_start", { withTimezone: true }),
    clientName: text("client_name").notNull(),
    description: text("description").notNull(),
    amount: fiatAmount("amount").notNull(),
    currency: fiatCurrency("currency").notNull(),
    dueDate: date("due_date"),
    status: invoiceStatus("status").notNull().default("open"),
    /** While status is "settling": the claim expires at this time (see invoice-claim.ts). */
    settlingUntil: timestamp("settling_until", { withTimezone: true }),
    createdAt: createdAt(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** When the freelancer cancelled it (only an open invoice can be cancelled). */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("invoices_recurring_period_uq").on(t.recurringId, t.periodStart),
    index("invoices_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const invoiceQuotes = pgTable(
  "invoice_quotes",
  {
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    asset: payAsset("asset").notNull(),
    amountAtomic: atomic("amount_atomic").notNull(),
    /** Tokens per one unit of the invoice currency, 18 decimals. */
    rate: numeric("rate", { precision: 60, scale: 18 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.invoiceId, t.asset] })],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    payer: text("payer").notNull(),
    asset: payAsset("asset").notNull(),
    amountAtomic: atomic("amount_atomic").notNull(),
    txHash: text("tx_hash").notNull().unique(),
    /** Textile reference rates (local units per USD, decimal strings) when the payment settled; P&L input (spec §10.5). */
    ratesSnapshot: jsonb("rates_snapshot").$type<Record<string, string>>(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);

/** Spec §10.2 and trade approvals §4: at most one open (proposed, waiting or executing) intent per user. */
export const fxIntents = pgTable(
  "fx_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromAsset: payAsset("from_asset").notNull(),
    toAsset: payAsset("to_asset").notNull(),
    amountAtomic: atomic("amount_atomic").notNull(),
    reason: intentReason("reason").notNull(),
    status: intentStatus("status").notNull().default("waiting"),
    attempts: integer("attempts").notNull().default(0),
    lastSlippageBps: integer("last_slippage_bps"),
    /** Textile asked us to wait (retryAfterMs) or an RFQ just failed; no new RFQ before this time. */
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    /** Trade approvals §4: the most the freelancer approved, in from_asset units; null until approved. */
    approvedAmountAtomic: atomic("approved_amount_atomic"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** The freelancer dismissed this proposal: its approval group stays quiet for 24 hours. */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    /** The approved hub_route intent whose approval this top_up inherited; unique, so an approval is inherited once. */
    approvedVia: uuid("approved_via")
      .unique()
      .references((): AnyPgColumn => fxIntents.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Names the closed statuses: the migration that adds 'proposed' cannot use that value in the same transaction.
  (t) => [uniqueIndex("fx_intents_one_open_uq").on(t.userId).where(sql`status not in ('filled', 'blocked', 'cancelled')`)],
);

/** One row per RFQ we sent, whatever came of it (spec §10.5 volume: requested, quoted, filled). */
export const fxTrades = pgTable(
  "fx_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    intentId: uuid("intent_id").references(() => fxIntents.id, { onDelete: "set null" }),
    rfqId: text("rfq_id"),
    /** Textile's ownership proof for submit/cancel/status; returned once by /rfq/request. */
    claimToken: text("claim_token"),
    sellAsset: payAsset("sell_asset").notNull(),
    buyAsset: payAsset("buy_asset").notNull(),
    /** takerPays once quoted, the requested amount otherwise. */
    sellAmount: atomic("sell_amount").notNull(),
    buyAmount: atomic("buy_amount"),
    feeAmount: atomic("fee_amount"),
    slippageBps: integer("slippage_bps"),
    notionalUsdCents: integer("notional_usd_cents").notNull().default(0),
    status: tradeStatus("status").notNull(),
    detail: text("detail"),
    swapTxHash: text("swap_tx_hash").unique(),
    createdAt: createdAt(),
    filledAt: timestamp("filled_at", { withTimezone: true }),
  },
  (t) => [index("fx_trades_user_created_idx").on(t.userId, t.createdAt)],
);

/** Every transaction a treasury wallet signed, stored before broadcast so it can be re-sent or settled (spec §10.4 step 7). */
export const treasuryTxs = pgTable(
  "treasury_txs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: txKind("kind").notNull(),
    nonce: integer("nonce").notNull(),
    hash: text("hash").notNull().unique(),
    raw: text("raw").notNull(),
    feeToken: text("fee_token").notNull(),
    status: txStatus("status").notNull().default("pending"),
    /** Withdrawals only: what was sent, where, and its USD value then. */
    asset: payAsset("asset"),
    amountAtomic: atomic("amount_atomic"),
    toAddress: text("to_address"),
    /** Withdrawals to a saved address: the label it had when the money left. */
    toLabel: text("to_label"),
    usdCents: integer("usd_cents"),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [index("treasury_txs_user_status_idx").on(t.userId, t.status)],
);

/** Addresses a freelancer may withdraw to besides their own wallet. Usable 24 h after saving; removal is immediate. */
export const withdrawalAddresses = pgTable(
  "withdrawal_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** Checksummed. */
    address: text("address").notNull(),
    createdAt: createdAt(),
    usableAt: timestamp("usable_at", { withTimezone: true }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("withdrawal_addresses_active_uq").on(t.userId, t.address).where(sql`removed_at is null`)],
);

/** Emailed confirmation codes for adding an address; only an HMAC of the code is stored. */
export const emailCodes = pgTable(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    label: text("label").notNull(),
    address: text("address").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("email_codes_user_created_idx").on(t.userId, t.createdAt)],
);

export const AGENT_EVENT_TYPES = [
  "dry_run",
  "converted",
  "waiting",
  "no_quote",
  "blocked",
  "policy_rejected",
  "swap_failed",
  "gas_dripped",
  "needs_gas",
  "withdrawn",
  "withdraw_failed",
  "paused",
  "resumed",
  "payment_reconciled",
  "proposed",
  "approved",
  "dismissed",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** The activity feed (spec §17.1 principle 4). Text comes from en.ts templates at display time. */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AgentEventType>().notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("agent_events_user_created_idx").on(t.userId, t.createdAt)],
);

/** Spec §10.4 step 1: one treasury run per wallet at a time; a crashed holder's lock expires. */
export const walletLocks = pgTable("wallet_locks", {
  walletId: uuid("wallet_id")
    .primaryKey()
    .references(() => treasuryWallets.id, { onDelete: "cascade" }),
  holder: uuid("holder").notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type TreasuryWalletRow = typeof treasuryWallets.$inferSelect;
export type RulesRow = typeof rules.$inferSelect;
export type RecurringInvoiceRow = typeof recurringInvoices.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceQuoteRow = typeof invoiceQuotes.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];
export type RecurringInterval = (typeof recurringInterval.enumValues)[number];
export type FxIntentRow = typeof fxIntents.$inferSelect;
export type FxTradeRow = typeof fxTrades.$inferSelect;
export type TreasuryTxRow = typeof treasuryTxs.$inferSelect;
export type WithdrawalAddressRow = typeof withdrawalAddresses.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AgentEventRow = typeof agentEvents.$inferSelect;
export type ApprovalMode = (typeof approvalMode.enumValues)[number];
export type IntentReason = (typeof intentReason.enumValues)[number];
export type TradeStatus = (typeof tradeStatus.enumValues)[number];
export type TxKind = (typeof txKind.enumValues)[number];
