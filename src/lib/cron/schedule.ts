/**
 * How often the agent looks at every treasury, in minutes. It mirrors the external cron-job.org
 * schedule that calls /api/cron/treasury (Plan 3b, kept at 20 for Neon Free compute); change both
 * together. Copy that tells the freelancer the interval reads it from here.
 */
export const CHECK_INTERVAL_MINUTES = 20;
