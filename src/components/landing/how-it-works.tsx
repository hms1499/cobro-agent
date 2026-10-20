"use client";

import { Pause, Play } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "@/i18n";
import { formatMoney } from "@/lib/money/format";
import { container, sectionTitle } from "./styles";
import { useReducedMotion } from "./use-reduced-motion";

const STEP_MS = 4500;
const STEPS = [
  { title: "landing.how.step1.title", body: "landing.how.step1.body" },
  { title: "landing.how.step2.title", body: "landing.how.step2.body" },
  { title: "landing.how.step3.title", body: "landing.how.step3.body" },
] as const;

const card = "rounded-2xl bg-card p-5 shadow-sm ring-1 ring-foreground/8";
const box = "flex h-11 items-center overflow-hidden rounded-lg border border-input px-3 whitespace-nowrap";
const field = `${box} mt-1.5 mb-3.5`;
const fakeButton = "flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground";

/**
 * "How it works" (landing spec §3.4): three steps that advance every 4.5 s, each with a small product frame.
 * Clicking a step selects it; the button pauses and resumes; reduced motion starts paused.
 */
export function HowItWorks() {
  const [active, setActive] = useState(0);
  // null until the visitor presses pause or play: the default follows their reduced-motion setting.
  const [pausedChoice, setPausedChoice] = useState<boolean | null>(null);
  const reduceMotion = useReducedMotion();
  const paused = pausedChoice ?? reduceMotion;
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const elapsed = useRef(0);

  useEffect(() => {
    bars.current.forEach((bar, i) => {
      if (bar) bar.style.width = i < active ? "100%" : i === active ? `${(elapsed.current / STEP_MS) * 100}%` : "0%";
    });
    if (paused) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const bar = bars.current[active];
      if (bar) bar.style.width = `${Math.min(100, (elapsed.current / STEP_MS) * 100)}%`;
      if (elapsed.current >= STEP_MS) {
        elapsed.current = 0;
        setActive((step) => (step + 1) % STEPS.length);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, paused]);

  const select = (step: number) => {
    elapsed.current = 0;
    setActive(step);
  };

  return (
    <section id="how" className="scroll-mt-20 pb-16 md:pb-24">
      <div className={`${container} grid grid-cols-[minmax(0,1fr)] items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14`}>
        <div>
          <h2 className={sectionTitle}>{t("landing.how.title")}</h2>
          <ol className="mt-8 flex flex-col gap-1.5">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <button
                  type="button"
                  aria-current={i === active ? "step" : undefined}
                  onClick={() => select(i)}
                  className={`grid w-full grid-cols-[28px_1fr] gap-x-2.5 rounded-xl px-4 py-4 text-left transition-colors duration-[20ms] ease-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    i === active ? "bg-card shadow-sm ring-1 ring-foreground/8" : "hover:bg-primary/4"
                  }`}
                >
                  <span className={`pt-0.5 text-sm tabular-nums ${i === active ? "font-semibold text-primary" : "text-muted-foreground"}`}>{i + 1}.</span>
                  <span className="text-lg font-semibold tracking-tight">{t(step.title)}</span>
                  <span
                    className={`col-start-2 overflow-hidden text-[0.95rem] text-muted-foreground transition-[max-height] duration-200 ease-out ${i === active ? "max-h-24" : "max-h-0"}`}
                  >
                    {t(step.body)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-center gap-3 pl-4">
            <button
              type="button"
              onClick={() => setPausedChoice(!paused)}
              aria-label={paused ? t("landing.how.play") : t("landing.how.pause")}
              className="grid size-11 place-items-center rounded-full border bg-card transition-colors duration-[20ms] ease-in hover:bg-primary/6 active:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {paused ? <Play aria-hidden="true" className="size-4" /> : <Pause aria-hidden="true" className="size-4" />}
            </button>
            <span aria-hidden="true" className="flex gap-1.5">
              {STEPS.map((step, i) => (
                <span key={step.title} className="h-1 w-7 overflow-hidden rounded-full bg-border">
                  <span
                    ref={(el) => {
                      bars.current[i] = el;
                    }}
                    className="block h-full w-0 bg-primary"
                  />
                </span>
              ))}
            </span>
          </div>
        </div>
        <div aria-hidden="true" className="grid min-h-[420px] min-w-0 grid-cols-[minmax(0,1fr)] place-items-center rounded-3xl bg-[linear-gradient(160deg,color-mix(in_oklch,var(--tint)_32%,transparent),color-mix(in_oklch,var(--tint)_6%,transparent))] p-6 md:p-10">
          <Frame key={active}>{FRAMES[active]()}</Frame>
        </div>
      </div>
    </section>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-[420px] animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">{children}</div>;
}

const FRAMES = [
  () => (
    <div className={card}>
      <p className="mb-4 flex items-center gap-2.5 font-semibold">
        <Image src="/cobro-mark.svg" alt="" width={28} height={28} />
        {t("landing.how.frame.signIn")}
      </p>
      <p className="text-sm font-medium">{t("landing.how.frame.email")}</p>
      <p className={`${field} text-muted-foreground`}>ana@estudio.com.ar</p>
      <p className="text-sm font-medium">{t("landing.how.frame.code")}</p>
      <p className={`${field} tracking-[0.4em] tabular-nums`}>482 913</p>
      <p className={fakeButton}>{t("landing.how.frame.continue")}</p>
    </div>
  ),
  () => (
    <div className={card}>
      <p className="text-sm text-muted-foreground">{t("landing.how.frame.newInvoice")}</p>
      <p className="mt-1.5 flex items-baseline justify-between gap-3">
        <span className="text-lg font-semibold">Acme Inc.</span>
        <span className="text-[1.75rem] font-bold tracking-tight tabular-nums">{formatMoney("300", "USD")}</span>
      </p>
      <p className="text-sm text-muted-foreground">{t("landing.how.frame.invoiceFor")}</p>
      <p className="mt-4 text-sm font-medium">{t("landing.how.frame.link")}</p>
      <p className="mt-1.5 flex gap-2">
        <span className={`${box} min-w-0 flex-1 text-sm`}>
          <span className="truncate">cobro-agent.vercel.app/pay/8xKq2mPa</span>
        </span>
        <span className={fakeButton}>{t("landing.how.frame.copy")}</span>
      </p>
    </div>
  ),
  () => (
    <div className="flex flex-col gap-2.5">
      <div className={`${card} flex gap-2.5`}>
        <span className="mt-2 size-2 shrink-0 rounded-full bg-success" />
        <div>
          <p className="font-semibold">{t("landing.how.frame.saved", { amount: formatMoney("124.35", "USD") })}</p>
          <p className="text-sm text-muted-foreground">{t("landing.how.frame.savedWhy", { reserve: formatMoney("200000", "ARS") })}</p>
        </div>
      </div>
      <div className={`${card} flex gap-2.5`}>
        <span className="mt-2 size-2 shrink-0 rounded-full bg-warning" />
        <div>
          <p className="font-semibold">{t("landing.how.frame.ask")}</p>
          <p className="text-sm text-muted-foreground">{t("landing.how.frame.askBody", { amount: formatMoney("50000", "ARS") })}</p>
          <p className="mt-3 flex gap-2">
            <span className={`${fakeButton} min-h-9 text-sm`}>{t("landing.how.frame.approve")}</span>
            <span className="flex min-h-9 items-center rounded-lg border border-secondary-accent px-4 text-sm font-semibold text-primary">{t("landing.how.frame.notNow")}</span>
          </p>
        </div>
      </div>
    </div>
  ),
];
