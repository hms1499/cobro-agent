"use client";

import type { Icon } from "@phosphor-icons/react";
import {
  AddressBook,
  Clock,
  ClockCounterClockwise,
  GearSix,
  House,
  MagnifyingGlass,
  Plus,
  Receipt,
  Robot,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useEffect, useId, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { t, type MessageKey } from "@/i18n";
import { filterCommands, type Command } from "@/lib/ui/commands";

const ENTRIES: { id: string; group: Command["group"]; label: MessageKey; keywords: MessageKey; href: string; icon: Icon }[] = [
  { id: "home", group: "pages", label: "nav.home", keywords: "palette.kw.home", href: "/app", icon: House },
  { id: "invoices", group: "pages", label: "nav.invoices", keywords: "palette.kw.invoices", href: "/app/invoices", icon: Receipt },
  { id: "agent", group: "pages", label: "nav.agent", keywords: "palette.kw.agent", href: "/app/rules", icon: Robot },
  { id: "settings", group: "pages", label: "nav.settings", keywords: "palette.kw.settings", href: "/app/settings", icon: GearSix },
  { id: "new-invoice", group: "actions", label: "invoices.new", keywords: "palette.kw.newInvoice", href: "/app/invoices/new", icon: Plus },
  { id: "open", group: "actions", label: "palette.openInvoices", keywords: "palette.kw.open", href: "/app/invoices?status=open", icon: Clock },
  { id: "overdue", group: "actions", label: "palette.overdueInvoices", keywords: "palette.kw.overdue", href: "/app/invoices?status=overdue", icon: WarningCircle },
  { id: "withdraw", group: "actions", label: "withdraw.title", keywords: "palette.kw.withdraw", href: "/app/withdraw", icon: Wallet },
  { id: "history", group: "actions", label: "home.recent.agentHistory", keywords: "palette.kw.history", href: "/app/rules#history", icon: ClockCounterClockwise },
  { id: "addresses", group: "actions", label: "addresses.title", keywords: "palette.kw.addresses", href: "/app/settings/addresses", icon: AddressBook },
];

const COMMANDS: Command[] = ENTRIES.map(({ id, group, label, keywords, href }) => ({ id, group, label: t(label), keywords: t(keywords), href }));
const ICONS = new Map(ENTRIES.map((entry) => [entry.id, entry.icon]));
const GROUPS: { id: Command["group"]; label: MessageKey }[] = [
  { id: "pages", label: "palette.group.pages" },
  { id: "actions", label: "palette.group.actions" },
];

/** "⌘K" on Apple keyboards, "Ctrl K" elsewhere; the server and first paint say "Ctrl K". */
function useShortcutLabel(): string {
  const mac = useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
  return mac ? "⌘K" : "Ctrl K";
}

/**
 * Cmd/Ctrl+K jumps to any page or common action (desktop; the sidebar shows the trigger from 1024px).
 * A combobox over a listbox: type to filter, arrows to move, Enter to open, Escape to close.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const shortcut = useShortcutLabel();

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="hover-tint mx-3 mb-3 hidden min-h-11 items-center gap-3 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:flex">
        <MagnifyingGlass aria-hidden="true" className="size-4" />
        <span className="flex-1 text-left">{t("palette.open")}</span>
        <kbd className="rounded border border-border bg-card px-1.5 font-sans text-xs">{shortcut}</kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay-in fixed inset-0 z-50 bg-foreground/50 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="palette-in fixed inset-x-4 top-[12vh] z-50 mx-auto flex max-h-[70vh] max-w-lg flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        >
          <Dialog.Title className="sr-only">{t("palette.title")}</Dialog.Title>
          {/* Mounted only while open, so every opening starts from an empty query */}
          <PaletteBody onDone={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = filterCommands(COMMANDS, query);
  const current = results[Math.min(active, results.length - 1)];

  function go(command: Command) {
    onDone();
    // Tagged like a nav click, so the page area crossfades (app/app/layout.tsx).
    router.push(command.href, { transitionTypes: ["app-nav"] });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((Math.min(active, results.length - 1) + step + results.length) % results.length);
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      go(current);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <MagnifyingGlass aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
          aria-label={t("palette.title")}
          placeholder={t("palette.placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-h-13 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div id={listId} role="listbox" aria-label={t("palette.title")} className="overflow-y-auto p-2">
        {results.length === 0 && (
          <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("palette.empty", { query: query.trim() })}
          </p>
        )}
        {GROUPS.map((group) => {
          const items = results.filter((command) => command.group === group.id);
          if (items.length === 0) return null;
          return (
            <div key={group.id} role="group" aria-labelledby={`${listId}-${group.id}`} className="flex flex-col pb-1">
              <p id={`${listId}-${group.id}`} role="presentation" className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                {t(group.label)}
              </p>
              {items.map((command) => {
                const selected = command === current;
                const ItemIcon = ICONS.get(command.id) ?? MagnifyingGlass;
                return (
                  <div
                    key={command.id}
                    id={`${listId}-${command.id}`}
                    role="option"
                    aria-selected={selected}
                    onPointerMove={() => setActive(results.indexOf(command))}
                    onClick={() => go(command)}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm ${
                      selected ? "bg-tint/35 text-primary" : "text-foreground"
                    }`}
                  >
                    <ItemIcon aria-hidden="true" weight={selected ? "fill" : "regular"} className="size-5 shrink-0" />
                    <span className="flex-1 truncate">{command.label}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">{t("palette.hint")}</p>
    </>
  );
}
