import { ShieldWarning } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";
import { pendingAddressCode } from "@/lib/addresses/codes";
import { isUsable, listSavedAddresses } from "@/lib/addresses/repo";
import { MAX_SAVED_ADDRESSES } from "@/lib/addresses/validate";
import { requireUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db/client";
import { AddAddress, AddressList, type AddressItem } from "./address-book";

export const metadata: Metadata = { title: `${t("addresses.title")} · ${t("app.name")}` };

export default function AddressesPage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
      <PageHeader title={t("addresses.title")} intro={t("addresses.intro")} />
      <p className="flex max-w-prose items-start gap-2 rounded-lg bg-highlight p-3 text-sm">
        <ShieldWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t("addresses.warning")}
      </p>
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <Addresses />
      </Suspense>
    </main>
  );
}

async function Addresses() {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();
  const [saved, pending] = await Promise.all([listSavedAddresses(db, user.id), pendingAddressCode(db, user.id, now)]);
  const items: AddressItem[] = saved.map((a) => ({
    id: a.id,
    label: a.label,
    address: a.address,
    hoursLeft: isUsable(a, now) ? null : Math.ceil((a.usableAt.getTime() - now.getTime()) / 3_600_000),
  }));
  return (
    <>
      <section aria-labelledby="saved-title" className="flex flex-col gap-3">
        <h2 id="saved-title" className="text-lg font-semibold">
          {t("addresses.listTitle")}
        </h2>
        <AddressList items={items} />
      </section>
      {!user.email ? (
        <p role="status">{t("addresses.noEmail")}</p>
      ) : saved.length >= MAX_SAVED_ADDRESSES && !pending ? (
        <p role="status">{t("addresses.fullNote")}</p>
      ) : (
        <AddAddress email={user.email} pending={pending ? { label: pending.label, address: pending.address } : null} />
      )}
    </>
  );
}
