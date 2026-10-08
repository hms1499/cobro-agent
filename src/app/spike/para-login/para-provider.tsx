"use client";

import { Environment, ParaProvider } from "@getpara/react-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

const environment = process.env.NEXT_PUBLIC_PARA_ENVIRONMENT === "PROD" ? Environment.PROD : Environment.BETA;

// Para 3.21 deprecates paraModalConfig (auth methods, layout, theme): configure email-only
// sign-in and Cobro branding in the Para Developer Portal instead.
export function ParaSpikeProvider({ apiKey, children }: { apiKey: string; children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider paraClientConfig={{ apiKey, env: environment }} config={{ appName: "Cobro" }}>
        {children}
      </ParaProvider>
    </QueryClientProvider>
  );
}
