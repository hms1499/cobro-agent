import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { t, type MessageKey } from "@/i18n";

/** Accessible wiring for an input: label above, help and error below, linked by aria-describedby. */
export function fieldA11y(id: string, opts: { help?: string; error?: MessageKey }) {
  const describedBy = [opts.help ? `${id}-help` : null, opts.error ? `${id}-error` : null].filter(Boolean).join(" ");
  return {
    id,
    name: id,
    "aria-invalid": opts.error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  };
}

export function FormField({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: MessageKey;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {help && (
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1 text-sm text-destructive">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t(error)}
        </p>
      )}
    </div>
  );
}
