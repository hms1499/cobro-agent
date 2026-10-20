"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { LANDING_EXAMPLES, type LandingExample } from "@/lib/landing/examples";
import { flapCells } from "@/lib/landing/flap";
import { formatMoney } from "@/lib/money/format";

const CYCLE_MS = 5600;
const ROW_DELAY_MS = 450;
const GLYPH_MS = 70;
const CELL_STAGGER_MS = 25;
const GLYPHS = " $0123456789.,ARSU";

type Row = "paid" | "kept" | "saved";
const ROWS: { key: Row; label: "landing.board.paymentIn" | "landing.board.kept" | "landing.board.saved"; tone: string }[] = [
  { key: "paid", label: "landing.board.paymentIn", tone: "text-primary-foreground" },
  { key: "kept", label: "landing.board.kept", tone: "text-tint" },
  { key: "saved", label: "landing.board.saved", tone: "text-highlight" },
];

// Intl separates the currency code with a no-break space; a board cell shows a plain one.
const shown = (money: { amount: string; currency: "USD" | "ARS" }) => formatMoney(money.amount, money.currency).replace(/ /g, " ");
const settled = (example: LandingExample) => Object.fromEntries(ROWS.map(({ key }) => [key, flapCells(shown(example[key]))])) as Record<Row, string[]>;

/**
 * The landing hero's split-flap board (landing spec §3.3): an example payment and how the agent splits
 * it. The first example is rendered settled on the server; the cells turn over every few seconds after
 * hydration, never under reduced motion, and pause while the board is off-screen or the tab is hidden.
 */
export function FlapBoard() {
  const [index, setIndex] = useState(0);
  const [cells, setCells] = useState(() => settled(LANDING_EXAMPLES[0]));
  const [turning, setTurning] = useState<Set<string>>(() => new Set());
  // Bumped on every glyph a cell shows; used in the cell's key so React remounts it and the flip replays.
  const [ticks, setTicks] = useState<Record<Row, number[]>>(() => ({ paid: [], kept: [], saved: [] }));
  const board = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    let visible = true;
    let current = 0;
    let cycle: ReturnType<typeof setInterval> | null = null;

    const turnCell = (row: Row, i: number, target: string, flips: number) => {
      const id = `${row}-${i}`;
      if (flips <= 0) {
        setCells((prev) => ({ ...prev, [row]: prev[row].map((c, k) => (k === i ? target : c)) }));
        setTurning((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        return;
      }
      const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      setCells((prev) => ({ ...prev, [row]: prev[row].map((c, k) => (k === i ? glyph : c)) }));
      setTicks((prev) => {
        const next = [...prev[row]];
        next[i] = (next[i] ?? 0) + 1;
        return { ...prev, [row]: next };
      });
      setTurning((prev) => new Set(prev).add(id));
      later(() => turnCell(row, i, target, flips - 1), GLYPH_MS);
    };

    const advance = () => {
      current = (current + 1) % LANDING_EXAMPLES.length;
      setIndex(current);
      const target = settled(LANDING_EXAMPLES[current]);
      ROWS.forEach(({ key }, r) =>
        target[key].forEach((char, i) =>
          later(() => turnCell(key, i, char, 4 + Math.floor(Math.random() * 8)), r * ROW_DELAY_MS + i * CELL_STAGGER_MS),
        ),
      );
    };

    const stop = () => {
      if (cycle) clearInterval(cycle);
      cycle = null;
      timers.forEach(clearTimeout);
      timers.clear();
      // Land on the current example's real figures so a paused board never shows random glyphs.
      setCells(settled(LANDING_EXAMPLES[current]));
      setTurning(new Set());
    };
    const sync = () => {
      const run = visible && document.visibilityState === "visible";
      if (run && !cycle) cycle = setInterval(advance, CYCLE_MS);
      if (!run && cycle) stop();
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    if (board.current) observer.observe(board.current);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      stop();
    };
  }, []);

  const example = LANDING_EXAMPLES[index];
  return (
    <div ref={board} className="flex w-full max-w-[460px] flex-col gap-2.5 rounded-2xl bg-foreground p-4 shadow-[0_24px_48px_-24px] shadow-primary/60 sm:p-5">
      <p className="sr-only">
        {t("landing.board.srSummary", { client: example.client, paid: shown(example.paid), kept: shown(example.kept), saved: shown(example.saved) })}
      </p>
      <div aria-hidden="true" className="flex items-center gap-2.5 px-1 pb-1.5 text-sm text-primary-foreground/90">
        <span className="size-2 rounded-full bg-success" />
        <span className="min-w-0 flex-1 truncate">{t("landing.board.paid", { client: example.client })}</span>
        <span className="rounded-full bg-primary-foreground/10 px-2 py-0.5 text-xs text-primary-foreground/70">{t("landing.board.example")}</span>
      </div>
      {ROWS.map(({ key, label, tone }) => (
        <div key={key} aria-hidden="true" className="flex items-center justify-between gap-3 rounded-xl bg-primary-foreground/5 px-3 py-3 sm:px-3.5">
          <span className="text-xs whitespace-nowrap text-primary-foreground/60 sm:text-[0.8rem]">{t(label)}</span>
          <span className={`flex gap-0.5 font-mono text-[15px] font-semibold sm:text-lg ${tone}`}>
            {cells[key].map((char, i) => (
              <span
                key={`${i}-${ticks[key][i] ?? 0}`}
                className={`relative grid h-6 w-3 place-items-center rounded-[3px] bg-primary-foreground/10 after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-foreground/50 sm:h-7 sm:w-3.5 ${turning.has(`${key}-${i}`) ? "flap-turn" : ""}`}
              >
                {char}
              </span>
            ))}
          </span>
        </div>
      ))}
      <p aria-hidden="true" className="px-1 pt-1 text-xs text-primary-foreground/50">
        {t("landing.board.footer")}
      </p>
    </div>
  );
}
