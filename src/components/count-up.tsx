"use client";

import { useLayoutEffect, useRef } from "react";

const DURATION_MS = 600;
const NUMBER = /\d[\d,]*(?:\.\d+)?/;

/** The text with its first number replaced by `fraction` of it, keeping grouping and decimals. */
function partial(text: string, fraction: number): string {
  const match = NUMBER.exec(text);
  if (!match) return text;
  const decimals = match[0].split(".")[1]?.length ?? 0;
  const target = Number(match[0].replaceAll(",", ""));
  const shown = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
    target * fraction,
  );
  return text.slice(0, match.index) + shown + text.slice(match.index + match[0].length);
}

/**
 * A formatted figure ("ARS 1,200", "US$45.10") that counts up once on first paint (spec 4f §4.3).
 * Screen readers and reduced-motion users get the final value only. The server HTML holds the final
 * value (never a misleading zero while the page streams); a layout effect restarts from zero before the
 * first client paint.
 */
export function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Written to the DOM, not state: one React render, then the browser repaints the text per frame.
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      // easeOutCubic: fast start, gentle landing on the real figure.
      node.textContent = partial(value, 1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    node.textContent = partial(value, 0);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      node.textContent = value;
    };
  }, [value]);
  return (
    <>
      {/* key: a new value remounts the span, so React never updates the text node the effect replaced */}
      <span key={value} ref={ref} aria-hidden="true">
        {value}
      </span>
      <span className="sr-only">{value}</span>
    </>
  );
}
