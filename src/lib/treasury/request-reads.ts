import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { rules, type FxIntentRow, type RulesRow } from "@/lib/db/schema";
import { openProposal } from "./repo";

/** Per-request (React cache): the dashboard's banner, agent card and treasury summary share one read. */
export const getRulesRow = cache(async (userId: string): Promise<RulesRow | null> => {
  const [row] = await getDb().select().from(rules).where(eq(rules.userId, userId));
  return row ?? null;
});

/** Per-request (React cache): the nav dot, the dashboard and the agent card share one read. */
export const getOpenProposal = cache((userId: string): Promise<FxIntentRow | null> => openProposal(getDb(), userId));
