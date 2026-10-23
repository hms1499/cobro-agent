/** One entry in the command palette: a page to go to or an action that opens its screen. */
export interface Command {
  id: string;
  group: "pages" | "actions";
  label: string;
  /** Extra words people may type for it ("create bill" for "New invoice"). */
  keywords: string;
  href: string;
}

/** Lowercase without accents, so "factura" finds "Factura" and "balanço" finds "balanco". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * The commands whose label or keywords contain every word of the query, label matches first; a blank
 * query keeps them all in their order.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  const scored: { command: Command; score: number }[] = [];
  for (const command of commands) {
    const label = fold(command.label);
    const all = `${label} ${fold(command.keywords)}`;
    if (!words.every((word) => all.includes(word))) continue;
    scored.push({ command, score: words.filter((word) => label.includes(word)).length });
  }
  // Array.prototype.sort is stable, so equal scores keep the list order.
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.command);
}
