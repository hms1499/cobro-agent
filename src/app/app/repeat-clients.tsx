// src/app/app/repeat-clients.tsx
import { Repeat } from "lucide-react";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/invoices/dates";
import { repeatClients } from "@/lib/treasury/stats";
import type { AppUser } from "@/lib/users/queries";

/** Spec §9.1: payments per recurring template and how many wallets paid them. Hidden without templates. */
export async function RepeatClients({ user }: { user: AppUser }) {
  const clients = await repeatClients(getDb(), user.id);
  if (clients.length === 0) return null;
  return (
    <section aria-labelledby="repeat-heading" className="flex flex-col gap-3">
      <h2 id="repeat-heading" className="text-lg font-semibold">
        {t("repeat.title")}
      </h2>
      <ul className="flex flex-col gap-3">
        {clients.map((client) => (
          <li key={client.recurringId} className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
            <Repeat aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">{client.clientName}</p>
              <p className="text-sm text-muted-foreground">
                {client.paidCount === 0
                  ? t("repeat.notYet")
                  : `${client.paidCount === 1 ? t("repeat.paidOnce") : t("repeat.paidMany", { count: client.paidCount })} ${
                      client.payerCount === 1 ? t("repeat.payerOne") : t("repeat.payerMany", { count: client.payerCount })
                    }`}
              </p>
              {client.lastPaidAt && (
                <p className="text-sm text-muted-foreground">{t("repeat.lastPaid", { date: formatDate(client.lastPaidAt) })}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
