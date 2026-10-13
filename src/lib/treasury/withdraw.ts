// src/lib/treasury/withdraw.ts
import type { Hex } from "viem";
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

export type WithdrawField = "asset" | "amount";
export interface WithdrawInput {
  asset: PayAsset;
  amount: bigint;
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
  const available = withdrawableAmount(asset, balances);
  if (fields.all === "on") return { ok: true, data: { asset, amount: available } };
  const errors: FieldErrors<WithdrawField> = {};
  const parsed = parseFiatInput(fields.amount ?? "");
  if (!parsed.ok) {
    errors.amount = `money.error.${parsed.error}`;
    return { ok: false, errors };
  }
  const amount = parseDecimal(parsed.value, TOKENS[asset].decimals);
  if (amount > available) return { ok: false, errors: { amount: "withdraw.error.tooMuch" } };
  return { ok: true, data: { asset, amount } };
}

export type WithdrawError = "not_ready" | "no_personal_wallet" | "busy" | "insufficient" | "needs_gas" | "failed";
export type WithdrawResult = { ok: true; txHash: Hex; pending: boolean } | { ok: false; error: WithdrawError };

/** Spec §6.2 flow 5: treasury → the freelancer's own wallet, never anywhere else (encodeTreasuryCall). */
export async function withdraw(deps: ExecutorDeps, userId: string, input: WithdrawInput): Promise<WithdrawResult> {
  const ctx = await loadTreasuryContext(deps.db, userId);
  if (!ctx) return { ok: false, error: "not_ready" };
  const personalWallet = ctx.personalWallet;
  if (!personalWallet) return { ok: false, error: "no_personal_wallet" };
  const holder = crypto.randomUUID();
  if (!(await acquireWalletLock(deps.db, ctx.walletId, holder, deps.now()))) return { ok: false, error: "busy" };
  try {
    if ((await reconcilePending(deps, ctx)) > 0) return { ok: false, error: "busy" };
    const balances = await deps.chain.readBalances(ctx.address);
    if (input.amount <= 0n || input.amount > withdrawableAmount(input.asset, balances)) return { ok: false, error: "insufficient" };

    const { feeToken } = await ensureFeeToken(deps, ctx, balances, { asset: input.asset, amount: input.amount });
    if (!feeToken) return { ok: false, error: "needs_gas" };

    const call = encodeTreasuryCall(
      { kind: "withdraw", asset: input.asset, to: personalWallet, amount: input.amount },
      { allowedSpenders: deps.allowedSpenders, personalWallet },
    );
    const usdCents = await deps
      .rates()
      .then((rates) => Number(usdWad(input.asset, input.amount, rates) / 10n ** 16n))
      .catch(() => null);
    const extra = { asset: input.asset, amountAtomic: input.amount.toString(), toAddress: personalWallet, usdCents };
    const sent = await sendTreasuryTx(deps, ctx, deps.signer(ctx), "withdraw", call, feeToken, extra);
    // A missing receipt is settled (and announced) by the next run's reconciliation.
    if (sent.status === null) return { ok: true, txHash: sent.hash, pending: true };
    await settleWithdrawal(deps, { userId: ctx.userId, hash: sent.hash, asset: input.asset, amountAtomic: extra.amountAtomic }, sent.status);
    return sent.status === "success" ? { ok: true, txHash: sent.hash, pending: false } : { ok: false, error: "failed" };
  } finally {
    await releaseWalletLock(deps.db, ctx.walletId, holder);
  }
}
