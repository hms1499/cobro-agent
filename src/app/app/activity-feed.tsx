// src/app/app/activity-feed.tsx
import { ArrowSquareOut, CheckCircle, Clock, Info, WarningCircle } from "@phosphor-icons/react/ssr";
import { EmptyState } from "@/components/empty-state";
import { ActivityIllustration } from "@/components/illustrations";
import { ScrollToHash } from "@/components/scroll-to-hash";
import { t } from "@/i18n";
import { CHECK_INTERVAL_MINUTES } from "@/lib/cron/schedule";
import { getDb } from "@/lib/db/client";
import { getReferenceRatesOrNull } from "@/lib/fx/rates";
import { formatDateTime } from "@/lib/invoices/dates";
import { describeEvent, type EventTone } from "@/lib/treasury/explain";
import { HIDE_WHY_EVENTS } from "@/lib/dashboard/recent";
import { listEvents } from "@/lib/treasury/repo";
import type { AppUser } from "@/lib/users/queries";

export const TONES: Record<EventTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle, className: "text-success" },
  warning: { icon: Clock, className: "text-warning" },
  alert: { icon: WarningCircle, className: "text-destructive" },
  info: { icon: Info, className: "text-muted-foreground" },
};

/** The Agent tab's history (spec §4.3): what happened and, under "Why?", why; routine events need no "Why?". */
export async function ActivityFeed({ user, limit = 40 }: { user: AppUser; limit?: number }) {
  const [events, rates] = await Promise.all([listEvents(getDb(), user.id, limit), getReferenceRatesOrNull()]);
  return (
    <section id="history" aria-labelledby="activity-heading" className="flex scroll-mt-6 flex-col gap-3">
      <ScrollToHash id="history" />
      <h2 id="activity-heading" className="text-lg font-semibold">
        {t("activity.title")}
      </h2>
      {events.length === 0 ? (
        <div className="rounded-xl bg-card ring-1 ring-foreground/10">
          <EmptyState
            illustration={<ActivityIllustration />}
            title={t("activity.emptyTitle")}
            body={t("activity.empty", { minutes: CHECK_INTERVAL_MINUTES })}
          />
        </div>
      ) : (
        <ul className="enter-stagger flex flex-col divide-y rounded-xl bg-card ring-1 ring-foreground/10">
          {events.map((event) => {
            const view = describeEvent(event, { local: user.localCurrency, rates });
            const { icon: Icon, className } = TONES[view.tone];
            return (
              <li key={event.id} className="flex items-start gap-3 px-4 py-3">
                <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className={`size-4 ${className}`} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-medium">{view.title}</p>
                  <time dateTime={event.createdAt.toISOString()} className="text-sm text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </time>
                  {!HIDE_WHY_EVENTS.includes(event.type) && (
                    <details className="text-sm">
                      <summary className="hover-tint -mx-2 min-h-11 w-fit cursor-pointer rounded-md px-2 py-2 text-primary">
                        {t("activity.why")}
                      </summary>
                      <p className="max-w-prose">{view.why}</p>
                      {view.txHash && (
                        <a
                          href={`https://celoscan.io/tx/${view.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4"
                        >
                          {t("activity.viewTx")}
                          <ArrowSquareOut aria-hidden="true" className="size-4" />
                        </a>
                      )}
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
