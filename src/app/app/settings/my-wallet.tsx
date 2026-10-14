"use client";

import { useModal } from "@getpara/react-sdk";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

/**
 * Opens Para's own account view for the freelancer's personal wallet, where they can send funds
 * out or export the key. Withdrawals land in this wallet (spec §6.1), so this is the way onward.
 * Para asks them to sign in again if its session has expired.
 */
export function MyWalletButton() {
  const { openModal } = useModal();
  return (
    <section aria-labelledby="my-wallet-heading" className="flex flex-col gap-2">
      <h2 id="my-wallet-heading" className="text-lg font-semibold">
        {t("settings.wallet.title")}
      </h2>
      <p className="max-w-prose text-muted-foreground">{t("settings.wallet.help")}</p>
      <Button variant="outline" size="lg" className="min-h-11 w-fit" onClick={() => openModal()}>
        <Wallet aria-hidden="true" className="size-4" />
        {t("settings.wallet.open")}
      </Button>
    </section>
  );
}
