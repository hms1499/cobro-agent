"use client";

import { LoaderCircle, Pause, Play } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { setAgentEnabled } from "./actions";

/** Outline, not primary: the screen's one primary action stays "New invoice" (MASTER.md "Buttons"). */
export function AgentToggle({ enabled }: { enabled: boolean }) {
  return (
    <form action={setAgentEnabled}>
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <ToggleButton enabled={enabled} />
    </form>
  );
}

function ToggleButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  const Icon = pending ? LoaderCircle : enabled ? Pause : Play;
  return (
    <Button type="submit" variant="outline" size="lg" className="min-h-11" disabled={pending} aria-disabled={pending}>
      <Icon aria-hidden="true" className={pending ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
      {pending ? t("agent.working") : enabled ? t("agent.pause") : t("agent.resume")}
    </Button>
  );
}
