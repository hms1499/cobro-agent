import type { MessageKey } from "@/i18n";

export type FieldErrors<F extends string> = Partial<Record<F, MessageKey>>;
export type FormResult<T, F extends string> = { ok: true; data: T } | { ok: false; errors: FieldErrors<F> };

/** String fields of a submitted form (file inputs are ignored). */
export function formFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}
