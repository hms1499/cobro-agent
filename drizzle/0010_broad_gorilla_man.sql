ALTER TABLE "fx_trades" ADD COLUMN "chat_card_id" uuid;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "auto_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fx_trades" ADD CONSTRAINT "fx_trades_chat_card_id_unique" UNIQUE("chat_card_id");