"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The treasury wallet is created after sign-in (in the session route's after()), so the dashboard may
 * render before it is ready. Re-render every few seconds until the banner that mounts this goes away;
 * after `maxTries` the banner's "Finish setup" button is the way forward.
 */
export function RefreshWhileCreating({ everyMs = 3_000, maxTries = 20 }: { everyMs?: number; maxTries?: number }) {
  const router = useRouter();
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (tries > maxTries) clearInterval(id);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs, maxTries]);
  return null;
}
