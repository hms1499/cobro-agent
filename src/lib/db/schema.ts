import {
  boolean,
  date,
  index,
  integer,
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
export const localCurrency = pgEnum("local_currency", ["ARS", "BRL"]);
export const payAsset = pgEnum("pay_asset", ["USAT", "USDT", "WARS", "WBRL"]);
export const invoiceStatus = pgEnum("invoice_status", ["open", "settling", "paid", "cancelled"]);
export const recurringInterval = pgEnum("recurring_interval", ["weekly", "monthly"]);
export const walletStatus = pgEnum("wallet_status", ["creating", "ready", "failed"]);
export const signerType = pgEnum("signer_type", ["para", "local"]);

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
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);

export type UserRow = typeof users.$inferSelect;
export type TreasuryWalletRow = typeof treasuryWallets.$inferSelect;
export type RulesRow = typeof rules.$inferSelect;
export type RecurringInvoiceRow = typeof recurringInvoices.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceQuoteRow = typeof invoiceQuotes.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];
export type RecurringInterval = (typeof recurringInterval.enumValues)[number];
