CREATE INDEX "invoices_settling_idx" ON "invoices" USING btree ("settling_until") WHERE status = 'settling';--> statement-breakpoint
CREATE INDEX "payments_tx_hash_lower_idx" ON "payments" USING btree (lower("tx_hash"));--> statement-breakpoint
CREATE INDEX "treasury_txs_pending_idx" ON "treasury_txs" USING btree ("user_id") WHERE status = 'pending';