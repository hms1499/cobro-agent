"use client";

import { verifyTx } from "@celo/attribution-tags";
import { CircleAlert, CircleCheck, Clock, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { Hex } from "viem";
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { celo } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { attributionSuffix } from "@/lib/chain/attribution";
import { registrationBlocker } from "@/lib/identity/admin-state";
import { agentCardUrl } from "@/lib/identity/agent-card";
import { IDENTITY_REGISTRY, extractRegisteredAgentId, identityRegistryAbi } from "@/lib/identity/registry";

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "confirming"; hash: Hex }
  | { kind: "done"; hash: Hex; agentId: bigint; tagged: boolean }
  | { kind: "error"; message: string };

interface Props {
  appUrl: string;
  attributionCode: string;
  agentWallet: string;
  agentId?: number;
}

export function AgentAdmin({ appUrl, attributionCode, agentWallet, agentId }: Props) {
  const connection = useConnection();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: celo.id });
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const registeredAgentId = phase.kind === "done" ? phase.agentId : agentId;
  const blocker = registrationBlocker({
    connectedAddress: connection.address,
    chainId: connection.chainId,
    agentWallet,
    registeredAgentId,
    isPending: phase.kind === "signing" || phase.kind === "confirming",
  });

  async function connect() {
    const connector = connectors[0];
    if (!connector) {
      setPhase({ kind: "error", message: t("admin.noWallet") });
      return;
    }
    await connectAsync({ connector, chainId: celo.id });
  }

  async function register() {
    if (!publicClient || blocker !== null) return;
    setPhase({ kind: "signing" });
    try {
      const hash = await writeContractAsync({
        address: IDENTITY_REGISTRY,
        abi: identityRegistryAbi,
        functionName: "register",
        args: [agentCardUrl(appUrl)],
        chainId: celo.id,
        dataSuffix: attributionSuffix(attributionCode),
      });
      setPhase({ kind: "confirming", hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const newAgentId = extractRegisteredAgentId(receipt.logs);
      if (receipt.status !== "success" || newAgentId === null) throw new Error(t("admin.errorNoEvent"));
      const decoded = await verifyTx({ client: publicClient, hash });
      setPhase({ kind: "done", hash, agentId: newAgentId, tagged: decoded?.codes.includes(attributionCode) ?? false });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">{t("admin.title")}</CardTitle>
        <CardDescription>{t("admin.intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("admin.factWallet")}</dt>
            <dd className="font-mono break-all">{agentWallet}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("admin.factCard")}</dt>
            <dd className="font-mono break-all">{agentCardUrl(appUrl)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("admin.factTag")}</dt>
            <dd className="font-mono">{attributionCode}</dd>
          </div>
        </dl>

        <div aria-live="polite" className="flex flex-col gap-3">
          {registeredAgentId !== undefined && (
            <p className="flex items-center gap-2 font-medium text-success">
              <CircleCheck aria-hidden="true" className="size-5" />
              {t("admin.registeredAs", { agentId: registeredAgentId.toString() })}
            </p>
          )}
          {phase.kind === "done" && (
            <>
              <p className={`flex items-center gap-2 ${phase.tagged ? "text-success" : "text-destructive"}`}>
                {phase.tagged ? (
                  <CircleCheck aria-hidden="true" className="size-5" />
                ) : (
                  <CircleAlert aria-hidden="true" className="size-5" />
                )}
                {phase.tagged ? t("admin.tagFound") : t("admin.tagMissing")}
              </p>
              <a
                href={`https://celoscan.io/tx/${phase.hash}`}
                target="_blank"
                rel="noreferrer"
                className="flex w-fit items-center gap-1 rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t("admin.viewTx")}
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
              <p className="text-sm text-muted-foreground">
                {t("admin.nextSteps", { agentId: phase.agentId.toString() })}
              </p>
            </>
          )}
          {(phase.kind === "signing" || phase.kind === "confirming") && (
            <p className="flex items-center gap-2 text-warning">
              <Clock aria-hidden="true" className="size-5" />
              {phase.kind === "signing" ? t("admin.signing") : t("admin.confirming")}
            </p>
          )}
          {blocker === "wrong-wallet" && (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-2 text-destructive">
                <CircleAlert aria-hidden="true" className="size-5 shrink-0" />
                {t("admin.wrongWallet")}
              </p>
              <p className="font-mono text-sm break-all text-muted-foreground">
                {t("admin.connectedAs", { address: connection.address ?? "" })}
              </p>
            </div>
          )}
          {phase.kind === "error" && (
            <p className="flex items-start gap-2 text-destructive" role="alert">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              <span className="break-words">{phase.message}</span>
            </p>
          )}
        </div>

        {blocker === "not-connected" && (
          <Button size="lg" className="min-h-11" onClick={connect}>
            {t("admin.connect")}
          </Button>
        )}
        {blocker === "wrong-wallet" && (
          <Button variant="outline" size="lg" className="min-h-11" onClick={() => disconnect()}>
            {t("admin.disconnect")}
          </Button>
        )}
        {blocker === "wrong-network" && (
          <Button size="lg" className="min-h-11" onClick={() => switchChainAsync({ chainId: celo.id })}>
            {t("admin.switch")}
          </Button>
        )}
        {(blocker === null || blocker === "pending") && (
          <Button size="lg" className="min-h-11" onClick={register} disabled={blocker === "pending"}>
            {phase.kind === "error" ? t("admin.retry") : t("admin.register")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
