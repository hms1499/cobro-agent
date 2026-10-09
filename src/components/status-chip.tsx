import { CircleAlert, CircleCheck, Clock, LoaderCircle } from "lucide-react";
import { t, type MessageKey } from "@/i18n";
import type { InvoiceStatus } from "@/lib/db/schema";

const CHIPS: Record<InvoiceStatus, { icon: typeof Clock; className: string; label: MessageKey }> = {
  open: { icon: Clock, className: "text-warning", label: "status.open" },
  settling: { icon: LoaderCircle, className: "text-warning", label: "status.settling" },
  paid: { icon: CircleCheck, className: "text-success", label: "status.paid" },
  cancelled: { icon: CircleAlert, className: "text-muted-foreground", label: "status.cancelled" },
};

/** Icon and text, never color alone (MASTER.md "Status chips"). */
export function InvoiceStatusChip({ status }: { status: InvoiceStatus }) {
  const chip = CHIPS[status];
  const Icon = chip.icon;
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium ${chip.className}`}>
      <Icon aria-hidden="true" className="size-4" />
      {t(chip.label)}
    </span>
  );
}
