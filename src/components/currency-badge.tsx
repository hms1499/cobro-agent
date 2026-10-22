import { ASSET_DENOMINATION, isPayAsset, type FiatCurrency, type PayAsset } from "@/lib/money/currencies";

/** Country letters instead of flag emoji (MASTER.md: no emoji as icons); each currency keeps one colour everywhere. */
const BADGES: Record<FiatCurrency, { letters: string; className: string }> = {
  USD: { letters: "US", className: "bg-primary text-primary-foreground" },
  ARS: { letters: "AR", className: "bg-tint text-primary" },
  BRL: { letters: "BR", className: "bg-highlight text-foreground ring-1 ring-foreground/10" },
};

/** A currency or pay token as a round badge; the currency name is always written next to it. */
export function CurrencyBadge({ code, size = "md" }: { code: FiatCurrency | PayAsset; size?: "sm" | "md" }) {
  const badge = BADGES[isPayAsset(code) ? ASSET_DENOMINATION[code] : code];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight ${badge.className} ${
        size === "sm" ? "size-6 text-[0.625rem]" : "size-8 text-xs"
      }`}
    >
      {badge.letters}
    </span>
  );
}
