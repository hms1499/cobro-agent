"use client";

import { useLogout } from "@getpara/react-sdk";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function SignOutButton() {
  const { logoutAsync } = useLogout();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await logoutAsync();
    } catch {
      // Para may already be signed out; our cookie is what matters.
    }
    await fetch("/api/session", { method: "DELETE" });
    router.replace("/");
  }

  return (
    <Button variant="outline" size="lg" className="min-h-11 w-fit" onClick={signOut} disabled={pending}>
      <LogOut aria-hidden="true" className="size-4" />
      {pending ? t("settings.signingOut") : t("settings.signOut")}
    </Button>
  );
}
