const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SLUG_LENGTH = 10;
/** 232 = 4 × 58: bytes at or above it are skipped so every character is equally likely. */
const LIMIT = 232;

export function newSlug(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  let slug = "";
  while (slug.length < SLUG_LENGTH) {
    for (const byte of randomBytes(16)) {
      if (byte < LIMIT && slug.length < SLUG_LENGTH) slug += ALPHABET[byte % 58];
    }
  }
  return slug;
}
