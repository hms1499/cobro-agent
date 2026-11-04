"use client";

import { ArrowSquareOut, CheckCircle, CircleNotch, PaperPlaneRight, WarningCircle } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { chooseRequest, refusedActions, twoStepRequest, type RefusedAction } from "@/lib/chat/next-step";
import { outcomeText } from "@/lib/chat/outcome";
import type { CardRequest, ChatReply } from "@/lib/chat/reply";
import { POLL_MS, pollDecision, resumeCardId, swapKeyStore, type PollDecision } from "@/lib/chat/swap-progress";
import { formatDateTime } from "@/lib/invoices/dates";
import { ASSET_DENOMINATION, PAY_ASSETS, type PayAsset } from "@/lib/money/currencies";
import { displayAmount } from "@/lib/money/display";
import { formatTokenAmount } from "@/lib/money/format";
import type { ChatSwapStatus, SwapCard as CardData } from "@/lib/treasury/chat-swap";
import { previewCardAction, readChatSwap, sendChatMessage, startChatSwap } from "./chat-actions";
import { fiat, SwapCard, type CardState } from "./swap-card";

type Balances = Record<PayAsset, string>;
type Success = Extract<ChatSwapStatus, { state: "success" }>;
type Item =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "reply"; reply: ChatReply; cardState: CardState }
  | { id: number; kind: "success"; status: Success; balances: Balances | null; offerSave: boolean }
  | { id: number; kind: "error"; retry: CardRequest | null };
type Running = { cardId: string; card: CardData | null; show: Extract<PollDecision, { kind: "continue" }>["show"] | "start" };

const linkClass =
  "inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const store = swapKeyStore(() => (typeof window === "undefined" ? null : window.localStorage));

function balanceText(asset: PayAsset, amount: string): string {
  return displayAmount(amount, ASSET_DENOMINATION[asset], null, null).primary;
}

function BalanceList({ balances }: { balances: Balances }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
      {PAY_ASSETS.map((asset) => (
        <div key={asset} className="contents">
          <dt className="text-muted-foreground">{t(`asset.${asset}.name` as const)}</dt>
          <dd className="text-right font-medium">{balanceText(asset, balances[asset])}</dd>
        </div>
      ))}
    </dl>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-destructive">
      <WarningCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Spec §6: the Swap assistant. Messages live in this component only. The one thing kept is a swap in progress
 * (spec §5.1): its card id is in the database and in localStorage, and the page polls it until it ends.
 */
export function SwapAssistant({
  activeCardId,
  paused,
  usdHome,
  walletAddress,
}: {
  activeCardId: string | null;
  paused: boolean;
  /** A dollars freelancer has no rules form to link to. */
  usdHome: boolean;
  /** For "How to add funds"; shown behind Details. */
  walletAddress: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<Running | null>(activeCardId ? { cardId: activeCardId, card: null, show: "start" } : null);
  const nextId = useRef(1);
  const saveFlow = useRef(false);
  // The card a running swap was started from, so a failed swap can offer "Try again" with the same pair and amount.
  const cardsInFlight = useRef(new Map<string, CardData>());
  const runningCardId = running?.cardId ?? null;

  const push = useCallback((make: (id: number) => Item) => {
    const item = make(nextId.current++);
    setItems((list) => {
      // A new card replaces any open one: only the latest card can be swapped.
      const older: Item[] =
        item.kind === "reply" && item.reply.kind === "card"
          ? list.map((i) => (i.kind === "reply" && i.cardState === "open" ? { ...i, cardState: "replaced" as const } : i))
          : list;
      return [...older, item];
    });
  }, []);
  const pushReply = useCallback((reply: ChatReply) => push((id) => ({ id, kind: "reply", reply, cardState: "open" })), [push]);

  // A reload: the server's active swap, or the id this browser stored, resumes with no card.
  useEffect(() => {
    const id = resumeCardId(activeCardId, store.read());
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
      setRunning((current) => current ?? { cardId: id, card: null, show: "start" });
    }
  }, [activeCardId]);

  // Poll the swap until it ends. A rejected read is a missing answer, never an exception (spec §5.1).
  useEffect(() => {
    if (!runningCardId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    // The 30 s clock counts consecutive missed answers from the first miss, not wall time (a locked phone is not a miss).
    let firstMissAt: number | null = null;
    const tick = async () => {
      let status: (ChatSwapStatus & { balances?: Balances; nextDailyAt?: string }) | null = null;
      try {
        status = await readChatSwap(runningCardId);
      } catch {
        status = null;
      }
      if (stopped) return;
      const decision = pollDecision(status, { firstMissAt, now: Date.now() });
      if (decision.kind === "continue") {
        firstMissAt = decision.firstMissAt;
        setRunning((r) => (r && r.cardId === runningCardId ? { ...r, show: decision.show } : r));
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      store.clear();
      const finished = cardsInFlight.current.get(runningCardId) ?? null;
      setItems((list) => list.filter((i) => !(i.kind === "reply" && i.reply.kind === "card" && i.reply.card.cardId === runningCardId)));
      const { terminal } = decision;
      if (terminal.kind === "success") {
        const offerSave = saveFlow.current;
        push((id) => ({ id, kind: "success", status: terminal.status, balances: status?.balances ?? null, offerSave }));
      } else {
        const card = finished;
        pushReply({
          kind: "refused",
          error: terminal.error,
          availableSellAtomic: null,
          nextDailyAt: status?.nextDailyAt ?? null,
          from: card?.from ?? null,
          to: card?.to ?? null,
          wantedAtomic: card?.amountAtomic ?? null,
          ...(status?.balances ? { balances: status.balances } : {}),
        });
      }
      setRunning(null);
      // A reverted swap leaves auto-convert off too, so the status panel refreshes on every ending.
      router.refresh();
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runningCardId, push, pushReply, router]);

  async function ask(label: string, message: string, save: boolean) {
    if (busy || running) return;
    saveFlow.current = save;
    push((id) => ({ id, kind: "user", text: label }));
    setBusy(true);
    try {
      pushReply(await sendChatMessage(message));
    } catch {
      push((id) => ({ id, kind: "error", retry: null }));
    } finally {
      setBusy(false);
    }
  }

  async function askCard(request: CardRequest) {
    if (busy || running) return;
    setBusy(true);
    try {
      pushReply(await previewCardAction(request));
    } catch {
      push((id) => ({ id, kind: "error", retry: request }));
    } finally {
      setBusy(false);
    }
  }

  async function swap(card: CardData) {
    if (busy || running) return;
    setBusy(true);
    // From the tap on, the card is the running one: a late preview of an edit can no longer replace it.
    setItems((list) => list.map((i) => (i.kind === "reply" && i.reply.kind === "card" && i.reply.card.cardId === card.cardId ? { ...i, cardState: "running" as const } : i)));
    try {
      const result = await startChatSwap({
        from: card.from,
        to: card.to,
        amountAtomic: card.amountAtomic,
        cardId: card.cardId,
        seenTurnsOff: card.turnsOff,
      });
      if (!result.started) {
        setItems((list) => list.filter((i) => !(i.kind === "reply" && i.reply.kind === "card" && i.reply.card.cardId === card.cardId)));
        if (result.error) {
          pushReply({
            kind: "refused",
            error: result.error,
            availableSellAtomic: null,
            nextDailyAt: null,
            from: card.from,
            to: card.to,
            wantedAtomic: card.amountAtomic,
          });
        } else {
          push((id) => ({ id, kind: "error", retry: { from: card.from, to: card.to, amountText: null, wantedAtomic: card.amountAtomic } }));
        }
        return;
      }
    } catch {
      // The request may have reached the server before it failed: the poll below finds out, and says "unconfirmed"
      // after 30 s if the swap never shows. Nothing is retried blindly.
    } finally {
      setBusy(false);
    }
    cardsInFlight.current.set(card.cardId, card);
    store.write(card.cardId);
    setRunning({ cardId: card.cardId, card, show: "start" });
  }

  function setCardState(id: number, cardState: CardState) {
    setItems((list) => list.map((i) => (i.id === id && i.kind === "reply" ? { ...i, cardState } : i)));
  }
  /** An answer to an edit applies only while its card is still the open one it was asked from. */
  function replaceReply(id: number, reply: ChatReply, fromCardId: string) {
    setItems((list) =>
      list.map((i) =>
        i.id === id && i.kind === "reply" && i.cardState === "open" && i.reply.kind === "card" && i.reply.card.cardId === fromCardId
          ? { ...i, reply }
          : i,
      ),
    );
  }

  // Paused hides the cards and the form, but never a swap still running or an outcome not yet shown (spec §5.1).
  const visible = paused ? items.filter((i) => i.kind === "success" || (i.kind === "reply" && i.reply.kind === "refused")) : items;
  const cardOpen = items.some((i) => i.kind === "reply" && i.reply.kind === "card" && i.cardState === "open") || running !== null;
  const locked = busy || running !== null;
  const step = running ? stepText(running.show) : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("chat.title")}</h2>
        <div aria-live="polite" className="flex flex-col gap-4">
          {items.length === 0 && !running && !paused && <p className="text-muted-foreground">{t("chat.intro")}</p>}
          {visible.map((item) => (
            <ItemView
              key={item.id}
              item={item}
              locked={locked}
              usdHome={usdHome}
              walletAddress={walletAddress}
              running={running}
              step={step}
              onCard={askCard}
              onSwap={swap}
              onCardState={setCardState}
              onReplace={replaceReply}
              onSave={() => ask(t("chat.saveInDollars"), "save in dollars", true)}
            />
          ))}
          {running && (!running.card || paused) && (
            <p role="status" className="flex min-h-11 items-center gap-2 font-medium">
              <CircleNotch aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
              {t("chat.inProgress")}
              {step ? `: ${step}` : ""}
            </p>
          )}
        </div>
        {paused ? (
          <p role="status">{t("chat.paused")}</p>
        ) : (
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const message = text.trim();
            if (!message) return;
            setText("");
            void ask(message, message, false);
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            {t("chat.inputLabel")}
          </label>
          <div className="flex gap-2">
            <Input
              id="chat-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("chat.placeholder")}
              autoComplete="off"
              disabled={locked}
              className="h-11 min-h-11 flex-1 text-base"
            />
            <Button type="submit" size="lg" variant={cardOpen ? "outline" : "default"} className="min-h-11" disabled={locked || text.trim() === ""}>
              <PaperPlaneRight aria-hidden="true" className="size-4" />
              {busy ? t("chat.sending") : t("chat.send")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="lg" className="min-h-11" disabled={locked} onClick={() => void ask(t("chat.saveInDollars"), "save in dollars", true)}>
              {t("chat.saveInDollars")}
            </Button>
            <Button type="button" variant="outline" size="lg" className="min-h-11" disabled={locked} onClick={() => void ask(t("chat.whatDoIHave"), "what do I have?", false)}>
              {t("chat.whatDoIHave")}
            </Button>
          </div>
        </form>
        )}
      </CardContent>
    </Card>
  );
}

function stepText(show: Running["show"]): string {
  if (show === "price" || show === "preparing" || show === "swapping") return t(`chat.step.${show}` as const);
  if (show === "confirming") return t("chat.confirming");
  return t("chat.inProgress");
}

function ItemView({
  item,
  locked,
  usdHome,
  walletAddress,
  running,
  step,
  onCard,
  onSwap,
  onCardState,
  onReplace,
  onSave,
}: {
  item: Item;
  locked: boolean;
  usdHome: boolean;
  walletAddress: string | null;
  running: Running | null;
  step: string | null;
  onCard: (request: CardRequest) => void;
  onSwap: (card: CardData) => void;
  onCardState: (id: number, state: CardState) => void;
  onReplace: (id: number, reply: ChatReply, fromCardId: string) => void;
  onSave: () => void;
}) {
  if (item.kind === "user") {
    return <p className="ml-auto max-w-[85%] rounded-xl bg-tint/35 px-3 py-2">{item.text}</p>;
  }
  if (item.kind === "error") {
    return (
      <div className="flex flex-col gap-2">
        <Problem>{t("chat.error.generic")}</Problem>
        {item.retry && <RetryButton request={item.retry} locked={locked} onCard={onCard} />}
      </div>
    );
  }
  if (item.kind === "success") return <SuccessView item={item} locked={locked} onSave={onSave} />;
  const { reply } = item;
  if (reply.kind === "card") {
    const isRunning = running?.cardId === reply.card.cardId;
    return (
      <SwapCard
        card={reply.card}
        state={isRunning ? "running" : item.cardState}
        step={isRunning ? step : null}
        locked={locked}
        usdHome={usdHome}
        onSwap={onSwap}
        onCancel={() => onCardState(item.id, "cancelled")}
        onReply={(next, fromCardId) => onReplace(item.id, next, fromCardId)}
      />
    );
  }
  return <ReplyView reply={reply} locked={locked} usdHome={usdHome} walletAddress={walletAddress} onCard={onCard} />;
}

function RetryButton({ request, locked, onCard }: { request: CardRequest; locked: boolean; onCard: (request: CardRequest) => void }) {
  return (
    <Button type="button" variant="outline" size="lg" className="min-h-11 w-fit" disabled={locked} onClick={() => onCard(request)}>
      {t("common.retry")}
    </Button>
  );
}

function ReplyView({
  reply,
  locked,
  usdHome,
  walletAddress,
  onCard,
}: {
  reply: Exclude<ChatReply, { kind: "card" }>;
  locked: boolean;
  usdHome: boolean;
  walletAddress: string | null;
  onCard: (request: CardRequest) => void;
}) {
  switch (reply.kind) {
    case "refused": {
      const actions = refusedActions(reply, { usdHome });
      return (
        <div className="flex flex-col gap-2">
          <Problem>{outcomeText(reply.error)}</Problem>
          {reply.error === "daily_limit" && reply.nextDailyAt && (
            <p className="text-sm text-muted-foreground">{t("chat.dailyAt", { when: formatDateTime(new Date(reply.nextDailyAt)) })}</p>
          )}
          {reply.error === "insufficient" && reply.balances && (
            <div className="flex flex-col gap-1 text-sm">
              {reply.from ? (
                <p className="tabular-nums">{t("chat.available", { amount: balanceText(reply.from, reply.balances[reply.from]) })}</p>
              ) : (
                <BalanceList balances={reply.balances} />
              )}
            </div>
          )}
          {actions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {actions.map((action) => (
                <RefusedButton key={action.kind + (action.kind === "link" ? action.label : "")} action={action} locked={locked} onCard={onCard} />
              ))}
            </div>
          )}
          {actions.some((a) => a.kind === "add_funds") && <AddFunds address={walletAddress} />}
        </div>
      );
    }
    case "choose":
      return (
        <div className="flex flex-col gap-2">
          <p>{t("chat.choose")}</p>
          <div className="flex flex-wrap gap-2">
            {reply.options.map((option) => (
              <Button
                key={option.from}
                type="button"
                variant="outline"
                size="lg"
                className="min-h-11"
                disabled={locked}
                onClick={() => onCard(chooseRequest(reply, option.from))}
              >
                {t("chat.chooseOption", { amount: fiat(option.from, option.atomic), currency: t(`asset.${option.from}.name` as const) })}
              </Button>
            ))}
          </div>
        </div>
      );
    case "two_step":
      return (
        <div className="flex flex-col gap-2">
          <p>{t("chat.twoStep")}</p>
          <Button type="button" variant="outline" size="lg" className="min-h-11 w-fit" disabled={locked} onClick={() => onCard(twoStepRequest(reply))}>
            {t("chat.twoStepFirst", { currency: t(`asset.${reply.from}.name` as const) })}
          </Button>
        </div>
      );
    case "nothing_to_swap":
      return (
        <div className="flex flex-col gap-2">
          <p>{t("chat.nothingToSwap")}</p>
          <BalanceList balances={reply.balances} />
        </div>
      );
    case "balances":
      return (
        <div className="flex flex-col gap-2">
          <p className="font-medium">{t("chat.balancesTitle")}</p>
          <BalanceList balances={reply.balances} />
        </div>
      );
    case "already_dollars":
      return <p>{t("chat.alreadyDollars")}</p>;
    case "same_token":
      return <p role="alert">{t("chat.sameToken")}</p>;
    case "bad_amount":
      return <Problem>{t("chat.badAmount")}</Problem>;
    case "paused":
      return <p role="alert">{t("chat.paused")}</p>;
    case "read_failed":
      return <Problem>{t("chat.error.generic")}</Problem>;
    case "help":
      return <p>{t("chat.help")}</p>;
  }
}

function AddFunds({ address }: { address: string | null }) {
  return (
    <details className="text-sm">
      <summary className="hover-tint -mx-2 min-h-11 w-fit cursor-pointer rounded-md px-2 py-2 text-primary">{t("chat.addFunds")}</summary>
      <ol className="ml-5 flex list-decimal flex-col gap-1">
        <li>{t("chat.addFundsStep1")}</li>
        <li>{t("chat.addFundsStep2")}</li>
        <li>{t("chat.addFundsStep3")}</li>
      </ol>
      {address && (
        <details className="mt-2">
          <summary className="hover-tint -mx-2 min-h-11 w-fit cursor-pointer rounded-md px-2 py-2 text-primary">{t("common.details")}</summary>
          <p className="text-muted-foreground">{t("chat.addFundsAddress")}</p>
          <p className="font-mono text-xs break-all">{address}</p>
        </details>
      )}
    </details>
  );
}

function RefusedButton({ action, locked, onCard }: { action: RefusedAction; locked: boolean; onCard: (request: CardRequest) => void }) {
  if (action.kind === "add_funds") return null;
  if (action.kind === "link") {
    return (
      <Link href={action.href} className={linkClass}>
        {t(action.label)}
      </Link>
    );
  }
  const label =
    action.kind === "retry"
      ? t("common.retry")
      : action.kind === "full_balance"
        ? t("chat.fullBalance")
        : t("chat.smaller", { amount: fiat(action.from, action.atomic) });
  return (
    <Button type="button" variant="outline" size="lg" className="min-h-11" disabled={locked} onClick={() => onCard(action.request)}>
      {label}
    </Button>
  );
}

function SuccessView({ item, locked, onSave }: { item: Extract<Item, { kind: "success" }>; locked: boolean; onSave: () => void }) {
  const { status, balances } = item;
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 font-medium">
        <CheckCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
        <span>{t("chat.success", { sold: fiat(status.from, status.soldAtomic), bought: fiat(status.to, status.boughtAtomic) })}</span>
      </p>
      {balances && (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{t("chat.newBalance")}</p>
          <BalanceList balances={balances} />
        </div>
      )}
      {status.turnedOff && (
        <div className="flex flex-col gap-2 rounded-lg bg-highlight p-3">
          <p>{t("chat.turnedOffNow")}</p>
          {/* One confirmation path: the status panel says what the agent would do before it turns on. */}
          <a href="#auto-convert" className={linkClass}>
            {t("agent.autoOn")}
          </a>
        </div>
      )}
      <details className="text-sm">
        <summary className="hover-tint -mx-2 min-h-11 w-fit cursor-pointer rounded-md px-2 py-2 text-primary">{t("common.details")}</summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
          <dt className="text-muted-foreground">{t("chat.card.sold")}</dt>
          <dd>{formatTokenAmount(BigInt(status.soldAtomic), status.from)}</dd>
          <dt className="text-muted-foreground">{t("chat.card.bought")}</dt>
          <dd>{formatTokenAmount(BigInt(status.boughtAtomic), status.to)}</dd>
        </dl>
        <a href={`https://celoscan.io/tx/${status.txHash}`} target="_blank" rel="noreferrer" className={linkClass}>
          {t("chat.card.viewTx")}
          <ArrowSquareOut aria-hidden="true" className="size-4" />
        </a>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        {item.offerSave && (
          <Button type="button" variant="outline" size="lg" className="min-h-11" disabled={locked} onClick={onSave}>
            {t("chat.saveInDollars")}
          </Button>
        )}
        <Link href="/app/rules/history" className={linkClass}>
          {t("chat.viewHistory")}
        </Link>
      </div>
    </div>
  );
}
