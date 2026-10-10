"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { projectHue } from "@/lib/format";
import { keyCaps } from "@/lib/hotkeys";
import type { Column } from "@/lib/types";
import Icon, { type IconName } from "./Icon";
import Modal from "./Modal";

export type PaletteItem = {
  id: string;
  group: "Commands" | "Projects" | "Cards" | "Prompts";
  label: string;
  // Dimmer text after the label, e.g. a project's path.
  detail?: string;
  // The project folder a card belongs to, drawn as a colored chip; on a project item it tints the icon.
  project?: string;
  // A card's column, drawn as a colored status pill.
  column?: Column;
  // Extra words that match the search without being shown.
  keywords?: string;
  icon: IconName;
  // A line of the prompt that matched, with the matched words between \u0001 and \u0002.
  snippet?: string;
  // A key spec from the shortcut registry, drawn as key caps.
  keys?: string;
  run: () => void;
};

const GROUPS: PaletteItem["group"][] = ["Commands", "Projects", "Cards", "Prompts"];
const PROMPT_DELAY_MS = 200;
const PROMPT_MIN_CHARS = 2;
const CARD_LIMIT = 30;
const RECENT_CARDS = 6;

const COLUMN_PILL: Record<Column, string> = {
  running: "bg-accent-soft text-accent",
  needs_you: "bg-warn-soft text-warn",
  review: "bg-ok-soft text-ok",
  backlog: "bg-sunken text-muted",
  done: "bg-sunken text-muted",
};
const COLUMN_LABEL: Record<Column, string> = {
  running: "Running",
  needs_you: "Needs you",
  review: "Review",
  backlog: "Backlog",
  done: "Done",
};

// The project's own color: deeper on light themes, lighter on dark, same hue on both.
function projectInk(name: string) {
  const hue = projectHue(name);
  return `light-dark(oklch(0.5 0.15 ${hue}), oklch(0.8 0.12 ${hue}))`;
}

function ProjectChip({ name }: { name: string }) {
  const hue = projectHue(name);
  return (
    <span
      title={`Project: ${name}`}
      className="flex max-w-[150px] shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
      style={{ color: projectInk(name), background: `oklch(0.65 0.14 ${hue} / 0.16)` }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: "currentColor" }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

// Every word typed must appear somewhere; earlier and label matches rank higher. null means no match.
function score(item: PaletteItem, words: string[]): number | null {
  const label = item.label.toLowerCase();
  const rest = `${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  let total = 0;
  for (const word of words) {
    const at = label.indexOf(word);
    if (at >= 0) total += at === 0 || label[at - 1] === " " ? 0 : 1;
    else if (rest.includes(word)) total += 3;
    else return null;
  }
  return total;
}

// A snippet with its matched words in bold.
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split("\u0001").map((part, i) => {
        const [hit, rest] = i === 0 ? ["", part] : part.split("\u0002");
        return (
          <span key={i}>
            {hit && <mark className="rounded-[3px] bg-accent-soft px-0.5 font-semibold text-ink">{hit}</mark>}
            {rest}
          </span>
        );
      })}
    </>
  );
}

export default function CommandPalette({
  items,
  findPrompts,
  onClose,
}: {
  items: PaletteItem[];
  // Prompts the user wrote that match the query; resolves with palette items for the ones on the board.
  findPrompts: (query: string) => Promise<PaletteItem[]>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [prompts, setPrompts] = useState<{ query: string; items: PaletteItem[] }>({ query: "", items: [] });
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  // The board makes a new findPrompts on every render; a pending search shouldn't restart for that.
  const find = useRef(findPrompts);
  useEffect(() => {
    find.current = findPrompts;
  });

  // Searching prompts hits the server, so it waits for a pause in typing and drops stale answers.
  useEffect(() => {
    const text = query.trim();
    if (text.length < PROMPT_MIN_CHARS) return;
    let stale = false;
    const timer = setTimeout(() => {
      find.current(text).then(
        (found) => !stale && setPrompts({ query: text, items: found }),
        () => !stale && setPrompts({ query: text, items: [] }),
      );
    }, PROMPT_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const byGroup = (group: PaletteItem["group"]) => items.filter((i) => i.group === group);
    if (words.length === 0) {
      // Nothing typed: every command and project, and only the latest cards (items arrive newest first).
      return [...byGroup("Commands"), ...byGroup("Projects"), ...byGroup("Cards").slice(0, RECENT_CARDS)];
    }
    const promptItems = prompts.query === query.trim() ? prompts.items : [];
    return GROUPS.flatMap((group) => {
      if (group === "Prompts") return promptItems;
      const hits = byGroup(group)
        .map((item, order) => ({ item, order, rank: score(item, words) }))
        .filter((h): h is { item: PaletteItem; order: number; rank: number } => h.rank !== null)
        .sort((a, b) => a.rank - b.rank || a.order - b.order);
      return (group === "Cards" ? hits.slice(0, CARD_LIMIT) : hits).map((h) => h.item);
    });
  }, [items, query, prompts]);

  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    // After the palette has unmounted, so a command that moves focus keeps it.
    setTimeout(item.run, 0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    const last = results.length - 1;
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) setActive(current >= last ? 0 : current + 1);
    else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) setActive(current <= 0 ? last : current - 1);
    else if (e.key === "Enter") choose(results[current]);
    else return;
    e.preventDefault();
  }

  return (
    <Modal label="Command palette" onClose={onClose} placement="top" className="max-h-[min(520px,76vh)] w-full max-w-[600px] overflow-hidden">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
          <Icon name="search" size={15} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search cards, prompts, and commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[current] ? `palette-${results[current].id}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-line-strong bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-muted">Esc</kbd>
        </div>
        <ul id="palette-results" ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">Nothing matches “{query.trim()}”</li>}
          {results.map((item, index) => {
            const heading = item.group !== results[index - 1]?.group;
            return (
              <li key={item.id} role="presentation">
                {heading && (
                  <div className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{item.group}</div>
                )}
                <div
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={index === current}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 ${
                    index === current ? "bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]" : ""
                  }`}
                >
                  <span className={`flex shrink-0 ${item.project ? "" : "text-muted"}`} style={item.project ? { color: projectInk(item.project) } : undefined}>
                    <Icon name={item.icon} size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
                    {item.label}
                    {item.column && (
                      <span className={`ml-2 rounded px-1.5 py-px align-[1px] text-[10.5px] font-semibold ${COLUMN_PILL[item.column]}`}>
                        {COLUMN_LABEL[item.column]}
                      </span>
                    )}
                    {item.detail && <span className="ml-2 text-[12px] font-normal text-faint">{item.detail}</span>}
                    {item.snippet && (
                      <span className="mt-1 block truncate text-[12.5px] font-normal text-muted">
                        <Snippet text={item.snippet} />
                      </span>
                    )}
                  </span>
                  {item.project && item.group !== "Projects" && <ProjectChip name={item.project} />}
                  {item.keys && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      {keyCaps(item.keys).map((cap, i) => (
                        <kbd
                          key={i}
                          className="min-w-[20px] rounded border border-line-strong bg-canvas px-1 py-px text-center font-mono text-[11px] text-muted"
                        >
                          {cap}
                        </kbd>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
    </Modal>
  );
}
