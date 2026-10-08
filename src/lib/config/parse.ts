import type { z } from "zod";

/** Turns "" (an unset line in a .env file) into undefined so defaults apply. */
export function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

/** Parses or throws one readable error that names each bad variable but never echoes its value. */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid ${label} environment: ${details}`);
  }
  return result.data;
}
