"use client";

import { Environment, ParaProvider } from "@getpara/react-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

// Para 3.21 deprecates paraModalConfig (auth methods, layout, theme): email-only sign-in and
// Cobro branding are configured in the Para Developer Portal instead.
export function ParaProviders({
  apiKey,
  environment,
  children,
}: {
  apiKey: string;
  environment: "BETA" | "PROD";
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{ apiKey, env: environment === "PROD" ? Environment.PROD : Environment.BETA }}
        config={{ appName: "Cobro" }}
      >
        {children}
      </ParaProvider>
    </QueryClientProvider>
  );
}
