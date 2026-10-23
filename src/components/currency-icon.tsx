import { ArrowRight } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { ASSET_DENOMINATION, isPayAsset, type FiatCurrency, type PayAsset } from "@/lib/money/currencies";

/** Simplified flags on a 24-unit square that the round frame crops (MASTER.md: no emoji as icons). */
const FLAGS: Record<FiatCurrency, ReactNode> = {
  USD: (
    <>
      <rect width="24" height="24" className="fill-flag-white" />
      {[0, 2, 4, 6].map((stripe) => (
        <rect key={stripe} y={(stripe * 24) / 7} width="24" height={24 / 7} className="fill-flag-red" />
      ))}
      <rect width="12" height={(4 * 24) / 7} className="fill-flag-navy" />
    </>
  ),
  ARS: (
    <>
      <rect width="24" height="24" className="fill-flag-celeste" />
      <rect y="8" width="24" height="8" className="fill-flag-white" />
      <circle cx="12" cy="12" r="2.6" className="fill-flag-sun" />
    </>
  ),
  BRL: (
    <>
      <rect width="24" height="24" className="fill-flag-green" />
      <polygon points="2.5,12 12,4 21.5,12 12,20" className="fill-flag-yellow" />
      <circle cx="12" cy="12" r="4.4" className="fill-flag-blue" />
    </>
  ),
};

/** A token is its currency's flag plus its issuer's mark, so USA₮ and USD₮ no longer look alike. */
const TOKEN_MARKS: Record<PayAsset, { mark: string; className: string }> = {
  USAT: { mark: "₮", className: "bg-primary text-primary-foreground" },
  USDT: { mark: "₮", className: "bg-tether text-flag-white" },
  WARS: { mark: "w", className: "bg-foreground text-background" },
  WBRL: { mark: "w", className: "bg-foreground text-background" },
};

/** A currency or pay token as a round icon; the currency name is always written next to it. */
export function CurrencyIcon({ code, size = "md" }: { code: FiatCurrency | PayAsset; size?: "sm" | "md" }) {
  const token = isPayAsset(code) ? TOKEN_MARKS[code] : null;
  return (
    <span aria-hidden="true" className={`relative inline-flex shrink-0 ${size === "sm" ? "size-6" : "size-8"}`}>
      <span className="size-full overflow-hidden rounded-full ring-1 ring-foreground/10">
        <svg viewBox="0 0 24 24" className="size-full">
          {FLAGS[isPayAsset(code) ? ASSET_DENOMINATION[code] : code]}
        </svg>
      </span>
      {token && (
        <span
          className={`absolute -right-1 -bottom-1 inline-flex items-center justify-center rounded-full font-semibold leading-none ring-2 ring-card ${token.className} ${
            size === "sm" ? "size-3.5 text-[0.5625rem]" : "size-4 text-[0.625rem]"
          }`}
        >
          {token.mark}
        </span>
      )}
    </span>
  );
}

/** The tokens an agent action moved, as small icons (wARS → USD₮). Its title already names them. */
export function AssetTrail({ assets }: { assets: PayAsset[] }) {
  if (assets.length === 0) return null;
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1.5">
      {assets.map((asset, index) => (
        <span key={`${asset}-${index}`} className="inline-flex items-center gap-1.5">
          {index > 0 && <ArrowRight className="size-3 text-muted-foreground" />}
          <CurrencyIcon code={asset} size="sm" />
        </span>
      ))}
    </span>
  );
}
