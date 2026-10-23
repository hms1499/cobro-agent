ALTER TABLE "users" ADD COLUMN "invoice_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "number" integer;--> statement-breakpoint
UPDATE "invoices" SET "number" = ranked.n FROM (SELECT "id", row_number() OVER (PARTITION BY "user_id" ORDER BY "created_at", "id") AS n FROM "invoices") AS ranked WHERE ranked."id" = "invoices"."id";--> statement-breakpoint
UPDATE "users" SET "invoice_seq" = counts.c FROM (SELECT "user_id", count(*)::int AS c FROM "invoices" GROUP BY "user_id") AS counts WHERE counts."user_id" = "users"."id";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_user_number_uq" ON "invoices" USING btree ("user_id","number");
