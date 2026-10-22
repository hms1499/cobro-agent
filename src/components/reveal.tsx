"use client";

import { useEffect } from "react";

/**
 * Landing scroll reveal (spec 4f §4.3): elements marked `data-reveal` fade and rise into place once,
 * when 15% of them is visible; `data-reveal-delay` (ms) staggers a group. Mount once per page.
 * The server HTML is fully visible: only elements still below the fold after hydration are hidden,
 * so there is no flash, and nothing hides without JavaScript or under reduced motion (CSS in globals.css).
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = "shown";
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15 },
    );
    for (const el of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
      if (el.getBoundingClientRect().top < window.innerHeight) continue;
      el.style.setProperty("--reveal-delay", `${Number(el.dataset.revealDelay ?? 0)}ms`);
      el.dataset.reveal = "pending";
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return null;
}
