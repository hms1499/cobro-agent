"use client";

import { useEffect } from "react";

/**
 * Scrolls to `#id` once the element has streamed in. A link such as /app/rules#history lands before a
 * Suspense boundary has rendered its target, so the browser's own jump to the hash finds nothing.
 */
export function ScrollToHash({ id }: { id: string }) {
  useEffect(() => {
    if (window.location.hash === `#${id}`) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [id]);
  return null;
}
