import { CheckCircle, CircleDashed, CircleNotch, WarningCircle, XCircle } from "@phosphor-icons/react/ssr";
import { t, type MessageKey } from "@/i18n";
import { formatDate } from "@/lib/invoices/dates";
import type { TimelineStep } from "@/lib/invoices/view";

const LABEL: Record<TimelineStep["key"], MessageKey> = {
  created: "timeline.created",
  due: "timeline.due",
  settling: "timeline.settling",
  paid: "timeline.paid",
  cancelled: "timeline.cancelled",
};

function StepIcon({ step, late }: { step: TimelineStep; late: boolean }) {
  if (late) return <WarningCircle aria-hidden="true" className="size-5 text-destructive" />;
  if (step.key === "cancelled") return <XCircle aria-hidden="true" className="size-5 text-muted-foreground" />;
  if (step.key === "settling") return <CircleNotch aria-hidden="true" className="size-5 text-warning" />;
  if (step.done) return <CheckCircle aria-hidden="true" className="size-5 text-success" />;
  return <CircleDashed aria-hidden="true" className="size-5 text-muted-foreground" />;
}

function label(step: TimelineStep, late: boolean): string {
  if (late) return t("timeline.overdue");
  if (step.key === "paid" && !step.done) return t("timeline.awaiting");
  return t(LABEL[step.key]);
}

/** Created → due → paid (spec 4f item C). Each step says in words whether it happened. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  // A passed due date is only good news once the invoice is settled; before that it means overdue.
  const settled = steps.some((s) => (s.key === "paid" || s.key === "cancelled") && s.done);
  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const late = step.key === "due" && step.done && !settled;
        const tone = late ? "text-destructive" : step.done || step.key === "settling" ? "" : "text-muted-foreground";
        return (
          <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
            {index < steps.length - 1 && (
              <span aria-hidden="true" className="absolute bottom-0 left-2.5 top-6 w-px -translate-x-1/2 bg-border" />
            )}
            <StepIcon step={step} late={late} />
            <span className="flex flex-col">
              <span className={`text-sm font-medium ${tone}`}>{label(step, late)}</span>
              {step.at && <span className="text-xs text-muted-foreground">{formatDate(step.at)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
