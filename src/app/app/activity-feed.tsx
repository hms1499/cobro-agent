// src/app/app/activity-feed.tsx
import { CircleAlert, CircleCheck, Clock, ExternalLink, Info } from "lucide-react";
import { t } from "@/i18n";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDateTime } from "@/lib/invoices/dates";
import { describeEvent, type EventTone } from "@/lib/treasury/explain";
import { listEvents } from "@/lib/treasury/repo";
import type { AppUser } from "@/lib/users/queries";

const TONES: Record<EventTone, { icon: typeof Info; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: Clock, className: "text-warning" },
  alert: { icon: CircleAlert, className: "text-destructive" },
  info: { icon: Info, className: "text-muted-foreground" },
};

/** Spec §17.1 principle 4: every entry says what happened and, under "Why?", why. */
export async function ActivityFeed({ user }: { user: AppUser }) {
  const [events, rates] = await Promise.all([listEvents(getDb(), user.id, 20), getReferenceRatesOrNull()]);
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
      <h2 id="activity-heading" className="text-lg font-semibold">
        {t("activity.title")}
      </h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground">{t("activity.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => {
            const view = describeEvent(event, { local: user.localCurrency, rates });
            const { icon: Icon, className } = TONES[view.tone];
            return (
              <li key={event.id} className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
                <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${className}`} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-medium">{view.title}</p>
                  <time dateTime={event.createdAt.toISOString()} className="text-sm text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </time>
                  <details className="text-sm">
                    <summary className="min-h-11 cursor-pointer py-2 text-primary">{t("activity.why")}</summary>
                    <p className="max-w-prose">{view.why}</p>
                    {view.txHash && (
                      <a
                        href={`https://celoscan.io/tx/${view.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4"
                      >
                        {t("activity.viewTx")}
                        <ExternalLink aria-hidden="true" className="size-4" />
                      </a>
                    )}
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
