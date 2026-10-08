import type { Db } from "@/lib/db/client";
import { getReferenceRates } from "@/lib/fx/rates";
import { findPublicInvoice } from "@/lib/invoices/repo";
import { claimInvoice, recordPayment, releaseInvoice } from "./invoice-claim";
import type { PayFlowDeps } from "./pay-flow";
import { needsRates, quoteInvoice } from "./quote";
import { lockQuote } from "./quotes-repo";

/** Real database and Textile wiring for preparePayment/runPayFlow; x402 processing is added per request. */
export function invoicePaymentDeps(db: Db): Omit<PayFlowDeps, "process"> {
  return {
    now: () => new Date(),
    findInvoice: (slug) => findPublicInvoice(db, slug),
    quote: (invoice, asset) =>
      lockQuote(db, {
        invoiceId: invoice.id,
        asset,
        now: new Date(),
        compute: async () =>
          quoteInvoice({
            amount: invoice.amount,
            currency: invoice.currency,
            asset,
            rates: needsRates(invoice.currency, asset) ? await getReferenceRates() : null,
          }),
      }),
    claim: (invoiceId) => claimInvoice(db, invoiceId, new Date()),
    release: (invoiceId) => releaseInvoice(db, invoiceId),
    record: (payment) => recordPayment(db, { ...payment, now: new Date() }),
  };
}
