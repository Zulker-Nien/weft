"use client";

import { useState } from "react";
import { deleteTagQuestion, TAG_PALETTE, type TagInfo } from "@/lib/rail-view";
import { MAX_TAG } from "@/lib/tags";
import Icon from "./Icon";
import { TagDot } from "./TagPill";
import type { TagCatalog } from "./use-tag-catalog";

// 🏷 in the left rail: every tag, like a repo's GitHub labels page. Click one to filter the board to it
// (again to clear), drop a card on one to tag it, and create, rename, recolour or delete them here.
export default function TagsDrawer({
  catalog,
  active,
  onFilter,
  onDropCard,
}: {
  catalog: Pick<TagCatalog, "tags" | "create" | "rename" | "recolor" | "remove">;
  // The tag the board is filtered to, if any.
  active?: string;
  onFilter: (tag: string) => void;
  onDropCard: (cardId: string, tag: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | undefined>();
  const [picking, setPicking] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const { tags } = catalog;

  function create(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void catalog.create(name, color);
    setName("");
    setColor(undefined);
    setPicking(null);
  }

  function remove(tag: TagInfo) {
    if (window.confirm(deleteTagQuestion(tag.name, tag.count))) void catalog.remove(tag.name);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={create} className="border-b border-line px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPicking(picking === "" ? null : "")}
            title="Colour (optional)"
            aria-label="New tag colour"
            className="grid size-6 shrink-0 place-items-center rounded-md border border-line hover:bg-sunken"
          >
            {color ? <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} /> : name.trim() ? <TagDot tag={name.trim().toLowerCase()} /> : <span className="size-2.5 rounded-full border border-dashed border-faint" />}
          </button>
          <input
            value={name}
            maxLength={MAX_TAG}
            onChange={(e) => setName(e.target.value)}
            placeholder="New tag"
            aria-label="New tag name"
            className="min-w-0 flex-1 rounded-md border border-line bg-sunken px-2 py-1 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent"
          />
          <button type="submit" disabled={!name.trim()} className="shrink-0 rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
            Add
          </button>
        </div>
        {picking === "" && <Swatches value={color} onPick={(c) => {
              setColor(c);
              setPicking(null);
            }} />}
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {tags.length === 0 && (
          <p className="px-2 py-4 text-center text-[11.5px] leading-snug text-faint">
            No tags yet. Add one above, or right-click a card and pick Tags…, or drop a card on a tag here.
          </p>
        )}
        {tags.map((tag) => (
          <div
            key={tag.name}
            onDragOver={(e) => {
              e.preventDefault();
              setDropOn(tag.name);
            }}
            onDragLeave={() => setDropOn((d) => (d === tag.name ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              setDropOn(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) onDropCard(id, tag.name);
            }}
            className={`group mb-0.5 rounded-md ${active === tag.name ? "bg-accent-soft" : "hover:bg-sunken"} ${dropOn === tag.name ? "outline-2 outline-offset-1 outline-dashed outline-accent" : ""}`}
          >
            <div className="flex items-center gap-1.5 px-1.5 py-1">
              <button
                type="button"
                onClick={() => setPicking(picking === tag.name ? null : tag.name)}
                title="Change colour"
                aria-label={`Colour of ${tag.name}`}
                className="grid size-5 shrink-0 place-items-center rounded hover:bg-card"
              >
                <TagDot tag={tag.name} />
              </button>
              {renaming === tag.name ? (
                <RenameInput
                  name={tag.name}
                  onDone={(to) => {
                    setRenaming(null);
                    if (to && to !== tag.name) void catalog.rename(tag.name, to);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onFilter(tag.name)}
                  onDoubleClick={() => setRenaming(tag.name)}
                  aria-pressed={active === tag.name}
                  title={tag.description ?? (active === tag.name ? "Showing only this tag · click to show every card" : "Show only cards with this tag · double-click to rename")}
                  className={`min-w-0 flex-1 truncate text-left text-[12.5px] ${active === tag.name ? "font-medium text-accent" : "text-ink"}`}
                >
                  {tag.name}
                </button>
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-faint group-hover:hidden">{tag.count}</span>
              <span className="hidden shrink-0 items-center group-hover:flex">
                <button type="button" onClick={() => setRenaming(tag.name)} aria-label={`Rename ${tag.name}`} title="Rename" className="rounded p-0.5 text-muted hover:bg-card hover:text-ink">
                  <Icon name="pencil" size={11} />
                </button>
                <button type="button" onClick={() => remove(tag)} aria-label={`Delete ${tag.name}`} title="Delete" className="rounded p-0.5 text-muted hover:bg-card hover:text-danger">
                  <Icon name="trash" size={11} />
                </button>
              </span>
            </div>
            {picking === tag.name && (
              <div className="px-1.5 pb-1.5">
                <Swatches
                  value={tag.color}
                  onPick={(c) => {
                    setPicking(null);
                    if (c) void catalog.recolor(tag.name, c);
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="border-t border-line px-3 py-1.5 text-[10.5px] leading-snug text-faint">Click to filter · drop a card to tag it · double-click to rename</p>
    </div>
  );
}

// GitHub's label colours, one click each.
function Swatches({ value, onPick }: { value?: string; onPick: (color: string | undefined) => void }) {
  return (
    <div className="mt-1.5 grid grid-cols-8 gap-1" role="group" aria-label="Colours">
      {TAG_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          aria-label={c}
          aria-pressed={value?.toLowerCase() === c}
          className={`h-4 rounded ${value?.toLowerCase() === c ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : ""}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function RenameInput({ name, onDone }: { name: string; onDone: (to: string | null) => void }) {
  return (
    <input
      autoFocus
      defaultValue={name}
      maxLength={MAX_TAG}
      aria-label={`New name for ${name}`}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          // Cancels the rename only; the drawer stays open.
          e.stopPropagation();
          e.currentTarget.value = name;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => onDone(e.currentTarget.value.trim() || null)}
      className="min-w-0 flex-1 rounded border border-accent bg-panel px-1 text-[12.5px] text-ink outline-none"
    />
  );
}
