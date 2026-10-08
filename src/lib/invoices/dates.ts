export const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** YYYY-MM-DD in UTC, the format of Postgres `date` columns. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "Oct 15, 2026". Dates are calendar days, so they are read and printed in UTC. */
export function formatDate(value: Date | string, locale = "en-US"): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
