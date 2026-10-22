import { CircleAlert, CircleCheck, Clock, LoaderCircle } from "lucide-react";
import { t, type MessageKey } from "@/i18n";
import type { DisplayStatus } from "@/lib/invoices/view";

const CHIPS: Record<DisplayStatus, { icon: typeof Clock; className: string; label: MessageKey }> = {
  open: { icon: Clock, className: "text-warning", label: "status.open" },
  overdue: { icon: CircleAlert, className: "text-destructive", label: "status.overdue" },
  settling: { icon: LoaderCircle, className: "text-warning", label: "status.settling" },
  paid: { icon: CircleCheck, className: "text-success", label: "status.paid" },
  cancelled: { icon: CircleAlert, className: "text-muted-foreground", label: "status.cancelled" },
};

/** Icon and text, never color alone (MASTER.md "Status chips"). */
export function InvoiceStatusChip({ status, size = "md" }: { status: DisplayStatus; size?: "sm" | "md" }) {
  const chip = CHIPS[status];
  const Icon = chip.icon;
  const sizing = size === "sm" ? "gap-1 px-2 py-0.5 text-xs" : "gap-1 px-2.5 py-0.5 text-sm";
  return (
    <span className={`inline-flex w-fit items-center rounded-full bg-muted font-medium ${sizing} ${chip.className}`}>
      <Icon aria-hidden="true" className={size === "sm" ? "size-3.5" : "size-4"} />
      {t(chip.label)}
    </span>
  );
}
