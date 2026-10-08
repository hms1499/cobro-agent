"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";

export function CopyLink({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="share-link" className="text-sm font-medium">
        {label}
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="share-link" readOnly value={url} className="h-11 text-base" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" size="lg" className="min-h-11 shrink-0" onClick={copy}>
          {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
          {copied ? t("invoice.copied") : t("invoice.copy")}
        </Button>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? t("invoice.copied") : ""}
      </p>
    </div>
  );
}
