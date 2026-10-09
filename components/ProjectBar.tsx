"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useEscape } from "@/lib/use-escape";
import { api } from "@/lib/client";
import type { ProjectSummary, SortKey } from "@/lib/board-view";
import Icon from "./Icon";

export type { ProjectSummary, SortKey };

// How many of the most recent projects get a chip; the rest are under "More".
const RECENT_CHIPS = 6;

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "active", label: "Recently active" },
  { id: "oldest", label: "Oldest first" },
  { id: "cost", label: "Highest cost" },
];

const CHIP = "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px]";
const CHIP_ON = "border-accent bg-accent-soft text-accent";
const CHIP_OFF = "border-line-strong text-ink hover:bg-sunken";
const FIELD =
  "w-full min-w-0 rounded-md border border-line-strong bg-canvas px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-faint focus:border-accent";
const MENU_ACTION =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
const SUBMIT =
  "shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50";

// "/Users/me/dev/app/" -> "app"
export function folderName(folder: string) {
  const trimmed = folder.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || folder;
}

// "/Users/me/dev/app" -> "~/dev/app"
function shortPath(folder: string, home: string) {
  if (home && (folder === home || folder.startsWith(`${home}/`))) return `~${folder.slice(home.length)}`;
  return folder;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// Warn (needs you) wins over accent (running).
function StatusDot({ project }: { project: ProjectSummary }) {
  if (project.needsYou > 0) return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />;
  if (project.running > 0) return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />;
  return null;
}

// What the dot means, for screen readers.
function statusLabel(project: ProjectSummary) {
  const parts: string[] = [];
  if (project.needsYou > 0) parts.push(`${project.needsYou} ${project.needsYou === 1 ? "needs" : "need"} you`);
  if (project.running > 0) parts.push(`${project.running} running`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}

type Form = "none" | "open" | "new";

export default function ProjectBar({
  projects,
  total,
  selected,
  onSelect,
  query,
  onQuery,
  sort,
  onSort,
  home,
  onMenuOpenChange,
}: {
  projects: ProjectSummary[]; // already sorted, most recent first
  total: number; // total card count, for the "All" chip
  selected: string | null; // selected project path, null = all projects
  onSelect: (path: string | null) => void;
  query: string;
  onQuery: (query: string) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  home: string; // user's home dir, for shortening paths (~/dev/x) and default parent for new projects
  onMenuOpenChange?: (open: boolean) => void; // called when the dropdown opens/closes (the board hides a native browser overlay while it's open)
}) {
  const [open, setOpen] = useState(false);
  useEscape(open, () => setOpen(false));
  const [form, setForm] = useState<Form>("none");
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const menuChanged = useEffectEvent((isOpen: boolean) => onMenuOpenChange?.(isOpen));

  // While the menu is open, an outside click or Escape closes it. The board hears when it opens
  // and closes, including when the bar unmounts with the menu open.
  useEffect(() => {
    if (!open) return;
    menuChanged(true);
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      menuChanged(false);
    };
  }, [open]);

  // Keep the selected chip visible when the chip row scrolls.
  useEffect(() => {
    chipsRef.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  // A project picked from "More" (or just added) that isn't one of the recent six still gets a chip,
  // so the current filter is always visible.
  const recent = projects.slice(0, RECENT_CHIPS);
  const extra =
    selected && !recent.some((p) => p.path === selected)
      ? (projects.find((p) => p.path === selected) ?? { path: selected, lastActivity: 0, cards: 0, running: 0, needsYou: 0 })
      : null;
  const chips = extra ? [...recent, extra] : recent;

  function toggleMenu() {
    if (!open) {
      setForm("none");
      setError(null);
    }
    setOpen(!open);
  }

  function choose(path: string | null) {
    onSelect(path);
    setOpen(false);
  }

  function showForm(next: Form) {
    setError(null);
    if (next === form) {
      setForm("none");
      return;
    }
    if (next === "open") setFolder("");
    if (next === "new") {
      setName("");
      setParent(home ? `${home}/dev` : "~/dev");
    }
    setForm(next);
  }

  // Runs an add/create call and selects the folder it returns (null means the user cancelled).
  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    try {
      const path = await action();
      if (path) choose(path);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // The desktop app has a native folder picker; a browser tab gets a field to paste a path into.
  function openFolder() {
    const bridge = window.threadboard;
    if (!bridge) {
      showForm("open");
      return;
    }
    setForm("none");
    void run(async () => {
      const picked = await bridge.dialog.openFolder();
      return picked ? (await api.addProject(picked)).path : null;
    });
  }

  function addFolder(e: React.FormEvent) {
    e.preventDefault();
    const path = folder.trim();
    if (!path) {
      setError("Paste a folder path first.");
      return;
    }
    void run(async () => (await api.addProject(path)).path);
  }

  function createProject(e: React.FormEvent) {
    e.preventDefault();
    const projectName = name.trim();
    const parentFolder = parent.trim();
    if (!projectName) {
      setError("Name the project first.");
      return;
    }
    if (!parentFolder) {
      setError("Choose a parent folder.");
      return;
    }
    void run(async () => (await api.newProject(parentFolder, projectName)).path);
  }

  const newPath = name.trim() ? `${shortPath(parent.trim().replace(/\/+$/, ""), home)}/${name.trim()}` : "";

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-4">
      <div ref={chipsRef} className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:thin]">
        <button
          onClick={() => onSelect(null)}
          aria-pressed={selected === null}
          title="All projects"
          className={`${CHIP} ${selected === null ? CHIP_ON : CHIP_OFF}`}
        >
          All
          <span className={`tabular-nums ${selected === null ? "text-accent/70" : "text-faint"}`}>{total}</span>
        </button>
        {chips.map((project) => {
          const on = project.path === selected;
          return (
            <button
              key={project.path}
              onClick={() => onSelect(project.path)}
              aria-pressed={on}
              title={shortPath(project.path, home)}
              className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
            >
              <StatusDot project={project} />
              <span className="max-w-[160px] truncate">{folderName(project.path)}</span>
              <span className={`tabular-nums ${on ? "text-accent/70" : "text-faint"}`}>{project.cards}</span>
              <span className="sr-only">{statusLabel(project)}</span>
            </button>
          );
        })}
      </div>

      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={toggleMenu}
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          className={`${CHIP} ${open ? CHIP_ON : CHIP_OFF}`}
        >
          More
          <Icon name="chevronDown" size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div
            id={menuId}
            className="absolute left-0 top-full z-40 mt-1.5 flex max-h-[min(540px,calc(100vh-110px))] w-[360px] flex-col rounded-lg border border-line bg-panel shadow-lg"
          >
            <div className="min-h-0 overflow-y-auto p-1">
              {projects.length === 0 && (
                <p className="px-2.5 py-2 text-[12px] text-muted">No projects yet. Open a folder or create one below.</p>
              )}
              {projects.map((project) => {
                const on = project.path === selected;
                return (
                  <button
                    key={project.path}
                    onClick={() => choose(project.path)}
                    aria-current={on ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left ${on ? "bg-accent-soft" : "hover:bg-sunken"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12.5px] ${on ? "text-accent" : "text-ink"}`}>
                        {folderName(project.path)}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted">{shortPath(project.path, home)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
                      {project.needsYou > 0 && (
                        <span className="text-warn">
                          {project.needsYou} {project.needsYou === 1 ? "needs" : "need"} you
                        </span>
                      )}
                      {project.running > 0 && <span className="text-accent">{project.running} running</span>}
                      <span className="text-faint">{plural(project.cards, "card", "cards")}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="shrink-0 border-t border-line p-1">
              <button onClick={openFolder} disabled={busy} className={MENU_ACTION}>
                <Icon name="folder" size={14} className="text-muted" /> Open folder…
              </button>
              {form === "open" && (
                <form onSubmit={addFolder} className="flex gap-1.5 px-2.5 pb-2 pt-1">
                  <input
                    autoFocus
                    value={folder}
                    onChange={(e) => {
                      setFolder(e.target.value);
                      setError(null);
                    }}
                    placeholder="~/dev/my-project"
                    aria-label="Folder path"
                    className={`${FIELD} font-mono`}
                  />
                  <button type="submit" disabled={busy} className={SUBMIT}>
                    Add
                  </button>
                </form>
              )}

              <button onClick={() => showForm("new")} disabled={busy} className={MENU_ACTION}>
                <Icon name="plus" size={14} className="text-muted" /> New project…
              </button>
              {form === "new" && (
                <form onSubmit={createProject} className="flex flex-col gap-2 px-2.5 pb-2 pt-1">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-muted">Name</span>
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setError(null);
                      }}
                      placeholder="my-project"
                      className={FIELD}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-muted">Parent folder</span>
                    <input
                      value={parent}
                      onChange={(e) => {
                        setParent(e.target.value);
                        setError(null);
                      }}
                      placeholder="~/dev"
                      className={`${FIELD} font-mono`}
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={newPath}>
                      {newPath}
                    </span>
                    <button type="submit" disabled={busy} className={SUBMIT}>
                      Create
                    </button>
                  </div>
                </form>
              )}

              {error && <p className="px-2.5 pb-2 pt-1 text-[12px] text-danger">{error}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="min-w-2 flex-1" />

      <div className="relative w-[200px] min-w-[120px] shrink">
        <Icon
          name="search"
          size={13}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              onQuery("");
            }
          }}
          placeholder="Filter cards"
          aria-label="Filter cards"
          className="w-full rounded-md border border-line-strong bg-canvas py-1 pl-7 pr-6 text-[12px] text-ink outline-none placeholder:text-faint focus:border-accent"
        />
        {query && (
          <button
            onClick={() => onQuery("")}
            aria-label="Clear filter"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:bg-sunken hover:text-ink"
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      <select
        value={sort}
        onChange={(e) => onSort(e.target.value as SortKey)}
        aria-label="Sort cards"
        className="shrink-0 rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
      >
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
