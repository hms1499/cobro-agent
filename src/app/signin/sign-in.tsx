"use client";

import { useAccount, useIssueJwt, useModal } from "@getpara/react-sdk";
import { CircleAlert, LoaderCircle, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { safeNext } from "@/lib/auth/gate";
import { prefillEmail } from "@/lib/landing/prefill";

type Phase = "idle" | "creating" | "error";

export function SignIn() {
  const { isConnected, isLoading } = useAccount();
  const { openModal } = useModal();
  const { issueJwtAsync } = useIssueJwt();
  const router = useRouter();
  const searchParams = useSearchParams();
  // "Start free" on the landing page sends its email field here as ?email=; Para shows it in its form.
  const email = prefillEmail(searchParams.get("email"));
  const [phase, setPhase] = useState<Phase>("idle");
  const started = useRef(false);
  const autoOpened = useRef(false);

  async function createSession() {
    started.current = true;
    setPhase("creating");
    try {
      const { token } = await issueJwtAsync();
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error(`Session request failed with ${response.status}`);
      const { next } = (await response.json()) as { next: string };
      router.replace(next === "/app" ? safeNext(searchParams.get("next")) : next);
    } catch {
      // Keep `started` set: the effect below runs on every render, so clearing it here would retry
      // in a tight loop. "Try again" calls createSession directly.
      setPhase("error");
    }
  }

  // Para's modal closes once the email code is accepted; continue without another click.
  // If lint reports react-hooks/set-state-in-effect here, move setPhase("creating") below the
  // first await in createSession; `started` already prevents a second run.
  useEffect(() => {
    if (isConnected && !started.current) void createSession();
  });

  // Wake the database and cache Para's keys while the freelancer types their email and code (src/lib/auth/warm.ts).
  useEffect(() => {
    void fetch("/api/session/warm", { method: "POST", keepalive: true }).catch(() => undefined);
  }, []);

  // One click fewer: open Para's email form as soon as the SDK is ready, once per visit. Closing it
  // leaves the page and its "Continue with email" button, which reopens it.
  useEffect(() => {
    if (isLoading || isConnected || autoOpened.current) return;
    autoOpened.current = true;
    openModal(email ? { defaultAuthIdentifier: email } : undefined);
  }, [isLoading, isConnected, openModal, email]);

  return (
    <div className="flex flex-col gap-4">
      {phase === "creating" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
          {t("signin.creating")}
        </p>
      ) : (
        <Button
          size="lg"
          className="min-h-11"
          onClick={() => (isConnected ? void createSession() : openModal(email ? { defaultAuthIdentifier: email } : undefined))}
        >
          <Mail aria-hidden="true" className="size-4" />
          {phase === "error" ? t("signin.retry") : t("signin.continue")}
        </Button>
      )}
      <div aria-live="polite">
        {phase === "error" && (
          <p className="flex items-start gap-2 text-destructive" role="alert">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t("signin.error")}
          </p>
        )}
      </div>
    </div>
  );
}
