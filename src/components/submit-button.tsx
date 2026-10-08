"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Primary form button: disabled with a spinner while its form's Server Action runs (MASTER.md "Buttons"). */
export function SubmitButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="min-h-11 w-full sm:w-auto" disabled={pending} aria-disabled={pending}>
      {pending && <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
      {pending ? pendingLabel : children}
    </Button>
  );
}
