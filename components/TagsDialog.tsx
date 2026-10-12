"use client";

import { useState } from "react";
import { addTag, removeTag, tagSuggestions } from "@/lib/rail-view";
import { MAX_TAG, MAX_TAGS } from "@/lib/tags";
import type { Card } from "@/lib/types";
import Modal from "./Modal";
import TagPill, { TagDot } from "./TagPill";

// Tags… (the card's right-click menu, or its tags in the thread header): the card's tags as chips you
// remove with ✕, and an input that suggests the board's tags. Enter or a comma adds, Backspace on an empty
// input removes the last. Every change saves right away (onChange PATCHes the card), which makes the tags
// yours, so Weft's retitle stops picking them (lib/tags.ts).
export default function TagsDialog({
  card,
  all = [],
  onChange,
  onClose,
}: {
  card: Card;
  // Every tag on the board with its count (lib/tags.ts tagCounts), for the suggestions.
  all?: { tag: string; count: number }[];
  onChange: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState(() => card.tags ?? []);
  const [text, setText] = useState("");
  // The suggestion ↑ and ↓ picked, if any.
  const [pick, setPick] = useState(-1);
  const suggestions = tagSuggestions(all, tags, text);
  const full = tags.length >= MAX_TAGS;

  function change(next: string[]) {
    setTags(next);
    onChange(next);
  }

  function add(raw: string) {
    setText("");
    setPick(-1);
    const next = addTag(tags, raw);
    if (next) change(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(suggestions[pick] ?? text);
    } else if (e.key === "Backspace" && !text && tags.length) {
      change(tags.slice(0, -1));
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const by = e.key === "ArrowDown" ? 1 : -1;
      setPick((p) => Math.max(-1, Math.min(suggestions.length - 1, p + by)));
    }
  }

  return (
    <Modal title={<span className="block truncate">Tags · {card.title}</span>} placement="top" onClose={onClose} className="w-full max-w-[400px]">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-sunken px-1.5 py-1 focus-within:border-accent">
          {tags.map((tag) => (
            <TagPill key={tag} tag={tag} className="max-w-[160px] min-w-0 text-[11.5px] leading-[20px]">
              <button type="button" onClick={() => change(removeTag(tags, tag))} aria-label={`Remove ${tag}`} className="-mr-0.5 rounded-full px-0.5 opacity-60 hover:opacity-100">
                ✕
              </button>
            </TagPill>
          ))}
          <input
            autoFocus
            value={text}
            maxLength={MAX_TAG + 2}
            disabled={full}
            onChange={(e) => {
              setText(e.target.value);
              setPick(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder={full ? `${MAX_TAGS} tags at most` : tags.length ? "Add a tag" : "bug, ui, docs…"}
            aria-label="Add a tag"
            className="min-w-[90px] flex-1 bg-transparent px-1 py-0.5 text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </div>
        {suggestions.length > 0 && !full && (
          <ul className="flex flex-col" role="listbox" aria-label="Suggestions">
            {suggestions.map((tag, i) => (
              <li key={tag} role="option" aria-selected={i === pick}>
                <button
                  type="button"
                  onClick={() => add(tag)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] text-ink ${i === pick ? "bg-accent-soft" : "hover:bg-sunken"}`}
                >
                  <TagDot tag={tag} />
                  <span className="flex-1 truncate">{tag}</span>
                  <span className="text-[11px] text-faint">{all.find((t) => t.tag === tag)?.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-faint">Enter or comma adds · Backspace removes the last · saved as you go</p>
      </div>
    </Modal>
  );
}
