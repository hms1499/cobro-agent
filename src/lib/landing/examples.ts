/**
 * Example payments for the landing page's split-flap board. They are labelled "Example" on the page and
 * add up at EXAMPLE_ARS_PER_USD (tested), so the board never shows arithmetic that doesn't work.
 */
export interface LandingExample {
  client: string;
  paid: { amount: string; currency: "USD" };
  kept: { amount: string; currency: "ARS" };
  saved: { amount: string; currency: "USD" };
}

export const EXAMPLE_ARS_PER_USD = 1600;
export const EXAMPLE_BRL_PER_USD = 5.4;

export const LANDING_EXAMPLES: readonly LandingExample[] = [
  { client: "Acme", paid: { amount: "300.00", currency: "USD" }, kept: { amount: "200000", currency: "ARS" }, saved: { amount: "175.65", currency: "USD" } },
  { client: "Nova Labs", paid: { amount: "1250.00", currency: "USD" }, kept: { amount: "350000", currency: "ARS" }, saved: { amount: "1031.80", currency: "USD" } },
  { client: "Pixel DAO", paid: { amount: "480.00", currency: "USD" }, kept: { amount: "120000", currency: "ARS" }, saved: { amount: "405.25", currency: "USD" } },
];
