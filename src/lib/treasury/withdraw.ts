// src/lib/treasury/withdraw.ts
import { getAddress, type Address, type Hex } from "viem";
import { usableSavedAddress } from "@/lib/addresses/repo";
import { safeErrorTag } from "@/lib/addresses/safe-error";
import { TOKENS } from "@/lib/chain/tokens";
import { encodeTreasuryCall, GAS_FLOOR_ATOMIC, GAS_TOKENS, pickGasToken, type GasToken } from "@/lib/chain/treasury-tx";
import type { FieldErrors, FormResult } from "@/lib/forms";
import { isPayAsset, type PayAsset } from "@/lib/money/currencies";
import { parseDecimal } from "@/lib/money/decimal";
import { parseFiatInput } from "@/lib/money/input";
import type { TreasuryBalances } from "./balances";
import { ensureFeeToken, reconcilePending, sendTreasuryTx, settleWithdrawal, type ExecutorDeps } from "./executor";
import { acquireWalletLock, loadTreasuryContext, releaseWalletLock } from "./repo";
import { usdWad } from "./value";

const isGasToken = (asset: string): asset is GasToken => (GAS_TOKENS as readonly string[]).includes(asset);

/** All of it, unless this same token must also pay the withdrawal's gas: then all but the gas floor. */
export function withdrawableAmount(asset: PayAsset, balances: TreasuryBalances): bigint {
  const balance = balances[asset];
  if (!isGasToken(asset) || pickGasToken({ ...balances, [asset]: 0n })) return balance;
  return balance > GAS_FLOOR_ATOMIC ? balance - GAS_FLOOR_ATOMIC : 0n;
}

export type WithdrawField = "asset" | "amount" | "to";
export interface WithdrawInput {
  asset: PayAsset;
  amount: bigint;
  /** "personal" (the Cobro wallet) or the id of a saved address. */
  to: "personal" | string;
}

/** The amount is typed in the asset's own currency (dollars for USD₮, pesos for wARS). */
export function parseWithdrawForm(
  fields: Record<string, string>,
  balances: TreasuryBalances,
): FormResult<WithdrawInput, WithdrawField> {
  const asset = fields.asset;
  if (!isPayAsset(asset) || withdrawableAmount(asset, balances) === 0n) {
    return { ok: false, errors: { asset: "withdraw.error.asset" } };
  }
  const to = fields.to;
  if (!to) return { ok: false, errors: { to: "withdraw.error.to" } };
  const available = withdrawableAmount(asset, balances);
  if (fields.all === "on") return { ok: true, data: { asset, amount: available, to } };
  const errors: FieldErrors<WithdrawField> = {};
  const parsed = parseFiatInput(fields.amount ?? "");
  if (!parsed.ok) {
    errors.amount = `money.error.${parsed.error}`;
    return { ok: false, errors };
  }
  const amount = parseDecimal(parsed.value, TOKENS[asset].decimals);
  if (amount > available) return { ok: false, errors: { amount: "withdraw.error.tooMuch" } };
  return { ok: true, data: { asset, amount, to } };
}

export type WithdrawError = "not_ready" | "no_personal_wallet" | "destination_not_ready" | "busy" | "insufficient" | "needs_gas" | "failed" | "unconfirmed";
export type WithdrawResult = { ok: true; txHash: Hex; pending: boolean } | { ok: false; error: WithdrawError };

/**
 * Spec §6.2 flow 5: treasury → the freelancer's own Cobro wallet, or one of their saved addresses once its
 * 24-hour wait has passed. The destination is resolved on the server from `to`; anything else is refused
 * (encodeTreasuryCall).
 */
export async function withdraw(deps: ExecutorDeps, userId: string, input: WithdrawInput): Promise<WithdrawResult> {
  // The hash, once signed, so the log can name the transaction to look up.
  let txHash: Hex | null = null;
  const traced: ExecutorDeps = {
    ...deps,
    signTx: async (...args) => {
      const signed = await deps.signTx(...args);
      txHash = signed.hash;
      return signed;
    },
  };
  try {
    return await withdrawUnguarded(traced, userId, input);
  } catch (error) {
    // Signing or the RPC failed, possibly after the transaction was stored and broadcast: money may have moved.
    // Only a tag: a failed insert's message carries the destination address and label.
    console.error(`Withdrawal for ${userId} ended with an error (tx ${txHash ?? "none"}):`, safeErrorTag(error));
    return { ok: false, error: "unconfirmed" };
  }
}

async function withdrawUnguarded(deps: ExecutorDeps, userId: string, input: WithdrawInput): Promise<WithdrawResult> {
  const ctx = await loadTreasuryContext(deps.db, userId);
  if (!ctx) return { ok: false, error: "not_ready" };
  const holder = crypto.randomUUID();
  if (!(await acquireWalletLock(deps.db, ctx.walletId, holder, deps.now()))) return { ok: false, error: "busy" };
  try {
    // Resolved inside the lock first, so a bad destination is refused before any drip or chain work.
    const destination = await resolveDestination(deps, ctx.userId, ctx.personalWallet, input.to);
    if ("error" in destination) return { ok: false, error: destination.error };
    const { address: to, label: toLabel } = destination;
    if ((await reconcilePending(deps, ctx)).stillPending > 0) return { ok: false, error: "busy" };
    const balances = await deps.chain.readBalances(ctx.address);
    if (input.amount <= 0n || input.amount > withdrawableAmount(input.asset, balances)) return { ok: false, error: "insufficient" };

    const { feeToken } = await ensureFeeToken(deps, ctx, balances, { asset: input.asset, amount: input.amount });
    if (!feeToken) return { ok: false, error: "needs_gas" };

    // Checked again just before signing: a saved address removed while the steps above ran is refused here.
    if (input.to !== "personal" && !(await usableSavedAddress(deps.db, ctx.userId, input.to, deps.now()))) {
      return { ok: false, error: "destination_not_ready" };
    }

    const call = encodeTreasuryCall(
      { kind: "withdraw", asset: input.asset, to, amount: input.amount },
      { allowedSpenders: deps.allowedSpenders, personalWallet: ctx.personalWallet, withdrawalAddresses: input.to === "personal" ? [] : [to] },
    );
    const usdCents = await deps
      .rates()
      .then((rates) => Number(usdWad(input.asset, input.amount, rates) / 10n ** 16n))
      .catch(() => null);
    const extra = { asset: input.asset, amountAtomic: input.amount.toString(), toAddress: to, toLabel, usdCents };
    const sent = await sendTreasuryTx(deps, ctx, deps.signer(ctx), "withdraw", call, feeToken, extra);
    // A missing receipt is settled (and announced) by the next run's reconciliation.
    if (sent.status === null) return { ok: true, txHash: sent.hash, pending: true };
    const row = { userId: ctx.userId, hash: sent.hash, asset: input.asset, amountAtomic: extra.amountAtomic, toLabel };
    // Refused by the node: nothing was sent, so this is a plain failure, not "unconfirmed".
    if (sent.status === "rejected") await settleWithdrawal(deps, row, "failed", "rejected");
    else await settleWithdrawal(deps, row, sent.status);
    return sent.status === "success" ? { ok: true, txHash: sent.hash, pending: false } : { ok: false, error: "failed" };
  } finally {
    await releaseWalletLock(deps.db, ctx.walletId, holder);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveDestination(
  deps: Pick<ExecutorDeps, "db" | "now">,
  userId: string,
  personalWallet: Address | null,
  to: string,
): Promise<{ address: Address; label: string | null } | { error: "no_personal_wallet" | "destination_not_ready" }> {
  if (to === "personal") return personalWallet ? { address: getAddress(personalWallet), label: null } : { error: "no_personal_wallet" };
  // A crafted value must not reach Postgres as a uuid.
  if (!UUID.test(to)) return { error: "destination_not_ready" };
  const saved = await usableSavedAddress(deps.db, userId, to, deps.now());
  return saved ? { address: saved.address, label: saved.label } : { error: "destination_not_ready" };
}
