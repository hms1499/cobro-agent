CREATE TYPE "public"."intent_reason" AS ENUM('save_excess', 'save_other', 'top_up', 'hub_route');--> statement-breakpoint
CREATE TYPE "public"."intent_status" AS ENUM('waiting', 'executing', 'filled', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('no_quote', 'rejected', 'expired', 'broadcast', 'filled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tx_kind" AS ENUM('approve', 'swap', 'withdraw');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('pending', 'success', 'reverted');--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_asset" "pay_asset" NOT NULL,
	"to_asset" "pay_asset" NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"reason" "intent_reason" NOT NULL,
	"status" "intent_status" DEFAULT 'waiting' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_slippage_bps" integer,
	"retry_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"intent_id" uuid,
	"rfq_id" text,
	"claim_token" text,
	"sell_asset" "pay_asset" NOT NULL,
	"buy_asset" "pay_asset" NOT NULL,
	"sell_amount" numeric(78, 0) NOT NULL,
	"buy_amount" numeric(78, 0),
	"fee_amount" numeric(78, 0),
	"slippage_bps" integer,
	"notional_usd_cents" integer DEFAULT 0 NOT NULL,
	"status" "trade_status" NOT NULL,
	"detail" text,
	"swap_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filled_at" timestamp with time zone,
	CONSTRAINT "fx_trades_swap_tx_hash_unique" UNIQUE("swap_tx_hash")
);
--> statement-breakpoint
CREATE TABLE "treasury_txs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "tx_kind" NOT NULL,
	"nonce" integer NOT NULL,
	"hash" text NOT NULL,
	"raw" text NOT NULL,
	"fee_token" text NOT NULL,
	"status" "tx_status" DEFAULT 'pending' NOT NULL,
	"asset" "pay_asset",
	"amount_atomic" numeric(78, 0),
	"to_address" text,
	"usd_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "treasury_txs_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "wallet_locks" (
	"wallet_id" uuid PRIMARY KEY NOT NULL,
	"holder" uuid NOT NULL,
	"locked_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "rates_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_intents" ADD CONSTRAINT "fx_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_trades" ADD CONSTRAINT "fx_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_trades" ADD CONSTRAINT "fx_trades_intent_id_fx_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."fx_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_txs" ADD CONSTRAINT "treasury_txs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_locks" ADD CONSTRAINT "wallet_locks_wallet_id_treasury_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."treasury_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_user_created_idx" ON "agent_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_intents_one_open_uq" ON "fx_intents" USING btree ("user_id") WHERE status in ('waiting', 'executing');--> statement-breakpoint
CREATE INDEX "fx_trades_user_created_idx" ON "fx_trades" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "treasury_txs_user_status_idx" ON "treasury_txs" USING btree ("user_id","status");