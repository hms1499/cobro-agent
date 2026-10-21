import { getAddress, isAddress, isAddressEqual, zeroAddress, type Address } from "viem";
import { t, type MessageKey } from "@/i18n";
import { TOKENS } from "@/lib/chain/tokens";
import { TEXTILE_REACTOR } from "@/lib/chain/treasury-tx";
import type { FormResult } from "@/lib/forms";

/** A new address cannot receive withdrawals until this long after it was saved. */
export const ADDRESS_WAIT_MS = 24 * 60 * 60 * 1000;
export const ADDRESS_LABEL_MAX = 40;
export const MAX_SAVED_ADDRESSES = 10;

export type AddressField = "label" | "address";

export interface NewAddress {
  label: string;
  address: Address;
}

/** Contracts that would swallow a transfer: every token we know, its gas adapter, and the Textile reactor. */
const CONTRACTS: Address[] = [
  ...Object.values(TOKENS).flatMap((token) => (token.feeCurrency ? [token.address, token.feeCurrency] : [token.address])),
  TEXTILE_REACTOR,
];

/** Control, format (bidi, zero-width), private-use and unassigned characters: they could forge lines or reorder text in the security email. */
const HIDDEN_CHARS = /\p{C}/u;

/** Names the UI uses for the Cobro wallet; a saved address must not pose as it. */
const RESERVED_LABELS = [t("withdraw.personalLabel"), t("withdraw.yourWallet")].map((l) => l.trim().toLowerCase());

export function parseAddressForm(
  fields: Record<string, string>,
  ctx: { treasury: Address | null; personalWallet: Address | null; saved: readonly Address[] },
): FormResult<NewAddress, AddressField> {
  const label = (fields.label ?? "").trim();
  const raw = (fields.address ?? "").trim();
  const errors: Partial<Record<AddressField, MessageKey>> = {};

  if (label.length < 1 || label.length > ADDRESS_LABEL_MAX || HIDDEN_CHARS.test(label)) errors.label = "addresses.error.label";
  else if (RESERVED_LABELS.includes(label.toLowerCase())) errors.label = "addresses.error.reservedLabel";

  // `isAddress` is strict: all-lowercase is accepted, mixed case must carry a valid checksum.
  if (!isAddress(raw)) {
    errors.address = "addresses.error.format";
  } else {
    const address = getAddress(raw);
    const same = (other: Address | null) => other !== null && isAddressEqual(address, other);
    if (isAddressEqual(address, zeroAddress)) errors.address = "addresses.error.zero";
    else if (same(ctx.treasury)) errors.address = "addresses.error.own";
    else if (same(ctx.personalWallet)) errors.address = "addresses.error.personal";
    else if (CONTRACTS.some((c) => isAddressEqual(address, c))) errors.address = "addresses.error.contract";
    else if (ctx.saved.some((s) => isAddressEqual(address, s))) errors.address = "addresses.error.duplicate";
    else if (ctx.saved.length >= MAX_SAVED_ADDRESSES) errors.address = "addresses.error.full";
    if (Object.keys(errors).length === 0) return { ok: true, data: { label, address } };
  }
  return { ok: false, errors };
}
