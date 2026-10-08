"use client";

import { CircleAlert, CircleCheck, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { erc20Abi } from "viem";
import {
  useConnect,
  useConnection,
  useConnectors,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { celo } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { PAY_ASSETS, type PayAsset } from "@/lib/money/currencies";
import { formatTokenAmount } from "@/lib/money/format";
import type { QuoteResponse } from "@/lib/payments/pay-flow";
import { formatCountdown, payBlocker, payErrorKey, payExceptionKind, secondsLeft } from "@/lib/payments/pay-state";
import { createInvoicePayerFetch } from "@/lib/payments/payer-client";
import { toX402Signer } from "@/lib/payments/wallet-signer";

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "settling" }
  | { kind: "paid"; txHash: string; amount: string }
  | { kind: "error"; key: MessageKey; retryQuote?: boolean }
  // The outcome is unknown or another payment is in flight: never offer to pay again, only a refresh.
  | { kind: "locked"; key: MessageKey };

const STEPS: MessageKey[] = ["pay.step.choose", "pay.step.connect", "pay.step.confirm", "pay.step.paid"];

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function PayInvoice({ slug }: { slug: string }) {
  const connection = useConnection();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient({ chainId: celo.id });
  const publicClient = usePublicClient({ chainId: celo.id });
  const now = useNow(1000);
  const [asset, setAsset] = useState<PayAsset | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [hasWallet, setHasWallet] = useState(true); // assume present until detection says otherwise, so nothing flashes
  const latestQuoteRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const connector = connectors[0];
    if (!connector) {
      Promise.resolve().then(() => !cancelled && setHasWallet(false));
    } else {
      connector
        .getProvider()
        .then((provider) => !cancelled && setHasWallet(Boolean(provider)))
        .catch(() => !cancelled && setHasWallet(false));
    }
    return () => {
      cancelled = true;
    };
  }, [connectors]);

  const amountAtomic = quote ? BigInt(quote.amountAtomic) : undefined;
  const balance = useReadContract({
    address: quote?.tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connection.address ? [connection.address] : undefined,
    chainId: celo.id,
    query: { enabled: Boolean(quote && connection.address) },
  });
  const expiresAt = quote ? Date.parse(quote.expiresAt) : undefined;
  const blocker = payBlocker({
    hasInjectedWallet: hasWallet,
    address: connection.address,
    chainId: connection.chainId,
    balance: balance.data,
    amountAtomic,
    expiresAt,
    now,
  });
  const busy = phase.kind === "signing" || phase.kind === "settling";
  const locked = phase.kind === "locked";
  // Once a payment is signed or its outcome is unknown, the controls follow the phase, not the wallet state.
  const activeBlocker = busy || locked ? null : blocker;
  const amountLabel = quote && asset ? formatTokenAmount(BigInt(quote.amountAtomic), asset) : "";

  async function loadQuote(next: PayAsset) {
    const request = ++latestQuoteRequest.current;
    const stale = () => latestQuoteRequest.current !== request;
    setAsset(next);
    setQuote(null);
    setLoadingQuote(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(`/api/pay/${slug}/quote?asset=${next}`, { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (stale()) return;
      if (response.ok) setQuote(body as QuoteResponse);
      else setPhase({ kind: "error", key: payErrorKey(response.status, body), retryQuote: true });
    } catch {
      if (!stale()) setPhase({ kind: "error", key: "pay.error.generic", retryQuote: true });
    } finally {
      if (!stale()) setLoadingQuote(false);
    }
  }

  async function connect() {
    try {
      await connectAsync({ connector: connectors[0], chainId: celo.id });
    } catch (error) {
      setPhase({ kind: "error", key: payExceptionKind(error) === "declined" ? "pay.error.declined" : "pay.error.connect" });
    }
  }

  async function pay() {
    if (!quote || !asset || !walletClient || !publicClient || blocker !== null || busy || locked) return;
    setPhase({ kind: "signing" });
    let signed = false;
    try {
      const payFetch = createInvoicePayerFetch(
        toX402Signer(walletClient, publicClient),
        { asset: quote.tokenAddress, amountAtomic: BigInt(quote.amountAtomic), payTo: quote.payTo },
        {
          onSigned: () => {
            signed = true;
            setPhase({ kind: "settling" });
          },
        },
      );
      const response = await payFetch(`/api/pay/${slug}?asset=${asset}`);
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setPhase({ kind: "paid", txHash: (body as { txHash: string }).txHash, amount: amountLabel });
        return;
      }
      // After signing, no failure is proof that nothing was paid, so never invite a second payment.
      if (signed || response.status === 502) {
        setPhase({ kind: "locked", key: "pay.error.unknown" });
        return;
      }
      if (response.status === 409) {
        setPhase({ kind: "locked", key: payErrorKey(response.status, body) });
        return;
      }
      if (response.status === 402) await loadQuote(asset);
      setPhase({ kind: "error", key: payErrorKey(response.status, body) });
    } catch (error) {
      if (signed) {
        setPhase({ kind: "locked", key: "pay.error.unknown" });
        return;
      }
      const kind = payExceptionKind(error);
      if (kind === "changed") await loadQuote(asset);
      setPhase({
        kind: "error",
        key: kind === "declined" ? "pay.error.declined" : kind === "changed" ? "pay.error.changed" : "pay.error.generic",
      });
    }
  }

  if (phase.kind === "paid") {
    return (
      <section role="status" className="flex flex-col gap-3">
        <Stepper current={4} />
        <p className="flex items-center gap-2 text-lg font-semibold text-success">
          <CircleCheck aria-hidden="true" className="size-6" />
          {t("pay.paidTitle")}
        </p>
        <p>{t("pay.paidBody", { amount: phase.amount })}</p>
        <a
          href={`https://celoscan.io/tx/${phase.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 w-fit items-center gap-2 rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("pay.receipt")}
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      </section>
    );
  }

  const step = !quote ? 1 : activeBlocker === "no-wallet" || activeBlocker === "connect" || activeBlocker === "switch-network" ? 2 : 3;

  return (
    <div className="flex flex-col gap-6">
      <Stepper current={step} />

      <fieldset className="flex flex-col gap-3" disabled={busy || locked}>
        <legend className="mb-1 text-lg font-semibold">{t("pay.choose")}</legend>
        {PAY_ASSETS.map((code) => (
          <label
            key={code}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-4 py-3 has-checked:border-primary has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <input
              type="radio"
              name="asset"
              value={code}
              checked={asset === code}
              onChange={() => void loadQuote(code)}
              className="size-4 accent-primary"
            />
            <span className="flex flex-col">
              <span className="font-medium">{t(`asset.${code}.name` as const)}</span>
              {code === "USAT" && <span className="text-sm text-muted-foreground">{t("pay.recommendedUs")}</span>}
            </span>
          </label>
        ))}
      </fieldset>

      <section aria-live="polite" className="flex flex-col gap-1">
        {!asset && <p className="text-muted-foreground">{t("pay.chooseHint")}</p>}
        {loadingQuote && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            {t("pay.loadingQuote")}
          </p>
        )}
        {quote && asset && (
          <>
            <p className="text-sm text-muted-foreground">{t("pay.youPay")}</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{amountLabel}</p>
            <p className="text-sm text-muted-foreground">{t("pay.noFee")}</p>
            {activeBlocker === "expired" && <p className="text-sm text-warning">{t("pay.expired")}</p>}
          </>
        )}
      </section>

      {/* Outside the live region: a ticking countdown would be announced every second. */}
      {quote && expiresAt !== undefined && activeBlocker !== "expired" && !locked && (
        <p role="timer" aria-live="off" className="-mt-4 text-sm text-muted-foreground tabular-nums">
          {t("pay.rateLocked", { time: formatCountdown(secondsLeft(expiresAt, now)) })}
        </p>
      )}

      {locked ? (
        <Button size="lg" className="min-h-11" onClick={() => window.location.reload()}>
          {t("pay.refresh")}
        </Button>
      ) : (
        quote &&
        asset && (
          <div className="flex flex-col gap-3">
            {activeBlocker === "no-wallet" && <p>{t("pay.noWallet")}</p>}
            {activeBlocker === "connect" && (
              <Button size="lg" className="min-h-11" onClick={connect}>
                {t("pay.connect")}
              </Button>
            )}
            {activeBlocker === "switch-network" && (
              <Button size="lg" className="min-h-11" onClick={() => void switchChainAsync({ chainId: celo.id }).catch(() => {})}>
                {t("pay.switch")}
              </Button>
            )}
            {activeBlocker === "expired" && (
              <Button size="lg" className="min-h-11" onClick={() => void loadQuote(asset)}>
                {t("pay.newRate")}
              </Button>
            )}
            {activeBlocker === "insufficient" && balance.data !== undefined && (
              <p className="text-warning">{t("pay.insufficient", { balance: formatTokenAmount(balance.data, asset) })}</p>
            )}
            {(busy || activeBlocker === null) && (
              <Button size="lg" className="min-h-11" onClick={pay} disabled={busy} aria-disabled={busy}>
                {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
                {phase.kind === "signing" ? t("pay.signing") : phase.kind === "settling" ? t("pay.settling") : t("pay.pay", { amount: amountLabel })}
              </Button>
            )}
          </div>
        )
      )}

      <div aria-live="assertive">
        {(phase.kind === "error" || phase.kind === "locked") && (
          <p role="alert" className="flex items-start gap-2 text-destructive">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {t(phase.key)}
          </p>
        )}
      </div>
      <div>
        {phase.kind === "error" && phase.retryQuote && asset && (
          <Button size="lg" className="min-h-11" onClick={() => void loadQuote(asset)}>
            {t("pay.retry")}
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol aria-label={t("pay.progress")} className="grid grid-cols-4 gap-2 text-xs">
      {STEPS.map((key, index) => {
        const n = index + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={key} aria-current={state === "current" ? "step" : undefined} className="flex flex-col gap-1">
            <span aria-hidden="true" className={`h-1.5 rounded-full ${state === "todo" ? "bg-muted" : "bg-primary"}`} />
            <span className={state === "current" ? "font-medium text-foreground" : "text-muted-foreground"}>{t(key)}</span>
          </li>
        );
      })}
    </ol>
  );
}
