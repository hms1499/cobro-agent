"use client";

import { useAccount, useIssueJwt, useModal } from "@getpara/react-sdk";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

type Result = { ok: true; body: unknown } | { ok: false; body: unknown } | null;

export function ParaLoginSpike() {
  const { isConnected } = useAccount();
  const { openModal } = useModal();
  const { issueJwtAsync } = useIssueJwt();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function verify() {
    setPending(true);
    try {
      const { token } = await issueJwtAsync();
      const response = await fetch("/api/spike/para-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setResult({ ok: response.ok, body: await response.json() });
    } catch (error) {
      setResult({ ok: false, body: { error: error instanceof Error ? error.message : String(error) } });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!isConnected ? (
        <Button size="lg" className="min-h-11" onClick={() => openModal()}>
          {t("spike.signIn")}
        </Button>
      ) : (
        <Button size="lg" className="min-h-11" onClick={verify} disabled={pending}>
          {t("spike.verify")}
        </Button>
      )}
      <div aria-live="polite">
        {result && (
          <div className="flex flex-col gap-2">
            <p className={`flex items-center gap-2 font-medium ${result.ok ? "text-success" : "text-destructive"}`}>
              {result.ok ? <CircleCheck aria-hidden="true" className="size-5" /> : <CircleAlert aria-hidden="true" className="size-5" />}
              {result.ok ? t("spike.verified") : t("spike.failed")}
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{JSON.stringify(result.body, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
