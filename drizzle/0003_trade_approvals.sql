CREATE TYPE "public"."approval_mode" AS ENUM('auto', 'sell_usd', 'all');--> statement-breakpoint
ALTER TYPE "public"."intent_status" ADD VALUE 'proposed' BEFORE 'waiting';--> statement-breakpoint
DROP INDEX "fx_intents_one_open_uq";--> statement-breakpoint
ALTER TABLE "fx_intents" ADD COLUMN "approved_amount_atomic" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "fx_intents" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fx_intents" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fx_intents" ADD COLUMN "approved_via" uuid;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "approval_mode" "approval_mode" DEFAULT 'sell_usd' NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_intents" ADD CONSTRAINT "fx_intents_approved_via_fx_intents_id_fk" FOREIGN KEY ("approved_via") REFERENCES "public"."fx_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_intents_one_open_uq" ON "fx_intents" USING btree ("user_id") WHERE status not in ('filled', 'blocked', 'cancelled');--> statement-breakpoint
ALTER TABLE "fx_intents" ADD CONSTRAINT "fx_intents_approved_via_unique" UNIQUE("approved_via");