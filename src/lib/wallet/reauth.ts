import { prefillEmail } from "@/lib/landing/prefill";

/**
 * What "Open my wallet" passes to Para's modal. Para's browser session can end before Cobro's 7-day
 * cookie (its length is set per API key in the Para portal), and the modal then shows its sign-in
 * form: prefill it with the email the freelancer signed up with so only the code is left to enter.
 */
export function walletModalOptions(email: string | null, isConnected: boolean): { defaultAuthIdentifier: string } | undefined {
  if (isConnected) return undefined;
  const prefilled = prefillEmail(email);
  return prefilled ? { defaultAuthIdentifier: prefilled } : undefined;
}
