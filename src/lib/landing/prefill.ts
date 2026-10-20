// One "@", no whitespace or angle brackets, and a dot in the domain. Para validates for real; this only
// decides whether the value is worth putting in its email field.
const PLAUSIBLE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_LENGTH = 254;

/** The address from `/signin?email=` to prefill in Para's modal, or undefined when it isn't plausible. */
export function prefillEmail(raw: string | null | undefined): string | undefined {
  const email = raw?.trim().toLowerCase();
  if (!email || email.length > MAX_LENGTH || !PLAUSIBLE.test(email)) return undefined;
  return email;
}
