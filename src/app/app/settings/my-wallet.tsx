"use client";

import { useAccount, useModal } from "@getpara/react-sdk";
import { Info, Wallet } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { walletModalOptions } from "@/lib/wallet/reauth";

/**
 * Opens Para's own account view for the freelancer's personal wallet, where they can send funds
 * out or export the key. Withdrawals can land in this wallet (spec §6.1), but it holds no CELO for
 * gas, so the way onward we point to is a saved address, where the agent pays the fee.
 * Para asks them to sign in again if its session has expired; the notice says so up front and the
 * form opens with their email filled in.
 */
export function MyWalletButton({ email }: { email: string | null }) {
  const { openModal } = useModal();
  const { isConnected, isLoading } = useAccount();
  const needsSignIn = !isLoading && !isConnected;
  return (
    <section aria-labelledby="my-wallet-heading" className="flex flex-col gap-2">
      <h2 id="my-wallet-heading" className="text-lg font-semibold">
        {t("settings.wallet.title")}
      </h2>
      <p className="max-w-prose text-muted-foreground">{t("settings.wallet.help")}</p>
      <Link
        href="/app/settings/addresses"
        className="inline-flex min-h-11 w-fit items-center text-primary underline underline-offset-4"
      >
        {t("settings.wallet.saveAddress")}
      </Link>
      {/* Para's wallet holds no CELO, and Para's send screen then reports a missing token balance instead. */}
      <p className="max-w-prose text-sm text-muted-foreground">{t("settings.wallet.gas")}</p>
      <div aria-live="polite">
        {needsSignIn && (
          <p className="enter-in flex max-w-prose items-start gap-2 text-sm text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {email ? t("settings.wallet.reauth", { email }) : t("settings.wallet.reauthNoEmail")}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="lg"
        className="min-h-11 w-fit"
        onClick={() => openModal(walletModalOptions(email, isConnected))}
      >
        <Wallet aria-hidden="true" className="size-4" />
        {t("settings.wallet.open")}
      </Button>
    </section>
  );
}
