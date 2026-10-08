CREATE TYPE "public"."fiat_currency" AS ENUM('USD', 'ARS', 'BRL');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('open', 'settling', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."local_currency" AS ENUM('ARS', 'BRL');--> statement-breakpoint
CREATE TYPE "public"."pay_asset" AS ENUM('USAT', 'USDT', 'WARS', 'WBRL');--> statement-breakpoint
CREATE TYPE "public"."recurring_interval" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."signer_type" AS ENUM('para', 'local');--> statement-breakpoint
CREATE TYPE "public"."wallet_status" AS ENUM('creating', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "invoice_quotes" (
	"invoice_id" uuid NOT NULL,
	"asset" "pay_asset" NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"rate" numeric(60, 18) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_quotes_invoice_id_asset_pk" PRIMARY KEY("invoice_id","asset")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"user_id" uuid NOT NULL,
	"recurring_id" uuid,
	"period_start" timestamp with time zone,
	"client_name" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" "fiat_currency" NOT NULL,
	"due_date" date,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"settling_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "invoices_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payer" text NOT NULL,
	"asset" "pay_asset" NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"tx_hash" text NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "recurring_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"user_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" "fiat_currency" NOT NULL,
	"interval" "recurring_interval" NOT NULL,
	"anchor_day" smallint NOT NULL,
	"next_issue_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_invoices_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"local_currency" "local_currency" NOT NULL,
	"reserve_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"auto_top_up" boolean DEFAULT true NOT NULL,
	"max_slippage_bps" integer DEFAULT 50 NOT NULL,
	"hard_max_slippage_bps" integer DEFAULT 150 NOT NULL,
	"max_wait_minutes" integer DEFAULT 360 NOT NULL,
	"per_trade_max_usd" integer DEFAULT 50 NOT NULL,
	"daily_max_usd" integer DEFAULT 200 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "wallet_status" DEFAULT 'creating' NOT NULL,
	"signer_type" "signer_type" DEFAULT 'para' NOT NULL,
	"para_wallet_id" text,
	"address" text,
	"gas_dripped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_wallets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"para_user_id" text NOT NULL,
	"email" text,
	"display_name" text,
	"personal_wallet" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_para_user_id_unique" UNIQUE("para_user_id")
);
--> statement-breakpoint
ALTER TABLE "invoice_quotes" ADD CONSTRAINT "invoice_quotes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_id_recurring_invoices_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_wallets" ADD CONSTRAINT "treasury_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_recurring_period_uq" ON "invoices" USING btree ("recurring_id","period_start");--> statement-breakpoint
CREATE INDEX "invoices_user_created_idx" ON "invoices" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "recurring_due_idx" ON "recurring_invoices" USING btree ("active","next_issue_at");