/** Cells per row on the landing page's split-flap board; fits "US$1,250.00" with room to spare. */
export const FLAP_WIDTH = 12;

/** Text as board cells: right-aligned and padded with spaces; longer text keeps its end. */
export function flapCells(text: string, width = FLAP_WIDTH): string[] {
  return [...text.padStart(width, " ").slice(-width)];
}
