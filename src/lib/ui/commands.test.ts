import { describe, expect, it } from "vitest";
import { filterCommands, type Command } from "./commands";

const commands: Command[] = [
  { id: "home", group: "pages", label: "Home", keywords: "dashboard balance", href: "/app" },
  { id: "new", group: "actions", label: "New invoice", keywords: "create bill client", href: "/app/invoices/new" },
  { id: "overdue", group: "actions", label: "Overdue invoices", keywords: "late", href: "/app/invoices?status=overdue" },
];

describe("filterCommands", () => {
  it("returns every command for a blank query", () => {
    expect(filterCommands(commands, "  ").map((c) => c.id)).toEqual(["home", "new", "overdue"]);
  });

  it("matches every word against the label or keywords, ignoring case and accents", () => {
    expect(filterCommands(commands, "INV").map((c) => c.id)).toEqual(["new", "overdue"]);
    expect(filterCommands(commands, "new bill").map((c) => c.id)).toEqual(["new"]);
    expect(filterCommands(commands, "factúra").map((c) => c.id)).toEqual([]);
    expect(filterCommands(commands, "dashböard").map((c) => c.id)).toEqual(["home"]);
  });

  it("puts label matches before keyword-only matches", () => {
    const list: Command[] = [
      { id: "a", group: "pages", label: "Settings", keywords: "invoice defaults", href: "/a" },
      { id: "b", group: "pages", label: "Invoices", keywords: "", href: "/b" },
    ];
    expect(filterCommands(list, "invoice").map((c) => c.id)).toEqual(["b", "a"]);
  });
});
