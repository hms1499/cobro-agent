"use client";

import { CircleNotch } from "@phosphor-icons/react/ssr";
import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * Form button, primary by default: disabled with a spinner while its form's Server Action runs (MASTER.md "Buttons").
 * Secondary actions pass another `variant`, so the screen keeps one primary button.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant,
}: {
  children: ReactNode;
  pendingLabel: string;
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="lg" className="min-h-11 w-full sm:w-auto" disabled={pending} aria-disabled={pending}>
      {pending && <CircleNotch aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
      {pending ? pendingLabel : children}
    </Button>
  );
}
