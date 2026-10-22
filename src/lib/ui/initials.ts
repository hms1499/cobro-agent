/** "Lucía Fernández Studio" → "LF": the avatar letters for a client or the account block. */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0].toLocaleUpperCase("en-US"));
  return letters.length > 0 ? letters.join("") : "?";
}
