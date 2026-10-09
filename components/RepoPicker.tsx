"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { GithubRepo, LocalRepo } from "@/lib/types";
import Icon, { Spinner, type IconName } from "./Icon";

// Where a new thread runs: a recent project, a git repo on this Mac, a GitHub repo (cloned into
// ~/dev on the spot), a folder from the Finder, or a pasted path.

type Choice =
  | { kind: "local"; repo: LocalRepo }
  | { kind: "github"; repo: GithubRepo }
  | { kind: "path"; path: string }
  | { kind: "browse" };

function shortPath(folder: string, home: string) {
  return home && (folder === home || folder.startsWith(`${home}/`)) ? `~${folder.slice(home.length)}` : folder;
}

function baseName(folder: string) {
  return folder.replace(/\/+$/, "").split("/").pop() || folder;
}

function matches(query: string, ...fields: (string | undefined)[]) {
  if (!query) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export default function RepoPicker({
  value,
  home,
  onChange,
}: {
  value: string;
  home: string;
  onChange: (folder: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [local, setLocal] = useState<LocalRepo[] | null>(null);
  const [github, setGithub] = useState<GithubRepo[] | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Local repos load with the dialog, so the button can show the branch.
  useEffect(() => {
    api
      .repos()
      .then((r) => setLocal(r.repos))
      .catch(() => setLocal([]));
  }, []);

  useEffect(() => {
    if (!open || github || githubError) return;
    api
      .githubRepos()
      .then((r) => setGithub(r.repos))
      .catch((err) => setGithubError(errorText(err)));
  }, [open, github, githubError]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = local?.find((r) => r.path === value);
  const q = query.trim();

  const sections = useMemo(() => {
    const out: { title: string; icon: IconName; choices: Choice[] }[] = [];
    if (/^(~|\/)/.test(q)) out.push({ title: "Folder", icon: "folder", choices: [{ kind: "path", path: q }] });
    const all = local ?? [];
    const recent = all.filter((r) => r.recentAt !== undefined && matches(q, r.name, r.path, r.github, r.branch));
    const repos = all.filter((r) => r.recentAt === undefined && matches(q, r.name, r.path, r.github, r.branch));
    if (recent.length) out.push({ title: "Recent", icon: "clock", choices: recent.slice(0, q ? 20 : 8).map((repo) => ({ kind: "local", repo })) });
    if (repos.length) out.push({ title: "On this Mac", icon: "branch", choices: repos.slice(0, q ? 40 : 25).map((repo) => ({ kind: "local", repo })) });
    // GitHub repos that aren't cloned yet; cloned ones are already listed above.
    const remote = (github ?? []).filter((r) => !r.localPath && matches(q, r.fullName, r.description));
    if (remote.length) out.push({ title: "Clone from GitHub", icon: "github", choices: remote.slice(0, q ? 40 : 15).map((repo) => ({ kind: "github", repo })) });
    return out;
  }, [q, local, github]);

  const flat = useMemo(() => [...sections.flatMap((s) => s.choices), { kind: "browse" } as Choice], [sections]);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function show() {
    setQuery("");
    setActive(0);
    setError(null);
    setOpen(true);
  }

  async function pick(choice: Choice) {
    setError(null);
    try {
      if (choice.kind === "local") {
        onChange(choice.repo.path);
        setOpen(false);
        return;
      }
      if (choice.kind === "path") {
        setBusy("path");
        onChange((await api.addProject(choice.path)).path);
      } else if (choice.kind === "github") {
        setBusy(choice.repo.fullName);
        const { path } = await api.cloneRepo(choice.repo.fullName);
        onChange(path);
        setGithub((repos) => repos?.map((r) => (r.fullName === choice.repo.fullName ? { ...r, localPath: path } : r)) ?? null);
        api
          .repos(true)
          .then((r) => setLocal(r.repos))
          .catch(() => {});
      } else {
        const bridge = window.threadboard;
        if (!bridge) {
          setError("Paste a folder path in the search box, starting with ~ or /.");
          return;
        }
        const picked = await bridge.dialog.openFolder();
        if (!picked) return;
        setBusy("browse");
        onChange((await api.addProject(picked)).path);
      }
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const choice = flat[active];
      if (choice && !busy) void pick(choice);
    }
  }

  let index = -1;

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={value}
        className={`flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12.5px] ${
          open ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-sunken"
        }`}
      >
        <Icon name={current?.github ? "github" : current?.git ? "branch" : "folder"} size={14} className="text-muted" />
        <span className="max-w-[200px] truncate font-medium text-ink">{baseName(value)}</span>
        {current?.branch && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-sunken px-1.5 py-px font-mono text-[11px] text-muted">
            <Icon name="branch" size={10} />
            {current.branch}
          </span>
        )}
        {/* Right-to-left so a long path loses its start, not the folder name. */}
        <span className="hidden max-w-[240px] truncate font-mono text-[11px] text-faint sm:inline" dir="rtl">
          <span dir="ltr">{shortPath(value, home)}</span>
        </span>
        <Icon name="chevronDown" size={13} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          onKeyDown={onKeyDown}
          className="absolute bottom-full left-0 z-50 mb-1.5 flex max-h-[min(460px,60vh)] w-[min(480px,calc(100vw-48px))] flex-col rounded-lg border border-line bg-panel shadow-2xl"
        >
          <div className="relative shrink-0 border-b border-line p-1.5">
            <Icon name="search" size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setError(null);
              }}
              placeholder="Search projects and repos, or paste a path"
              aria-label="Search folders"
              className="w-full rounded-md bg-canvas py-1.5 pl-8 pr-2 text-[12.5px] text-ink outline-none placeholder:text-faint"
            />
          </div>

          <div ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
            {local === null && (
              <p className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-muted">
                <Spinner size={11} /> Looking for repos…
              </p>
            )}
            {sections.map((section) => (
              <div key={section.title} className="mb-1">
                <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
                  <Icon name={section.icon} size={11} /> {section.title}
                </p>
                {section.choices.map((choice) => {
                  index++;
                  const i = index;
                  const on = i === active;
                  const rowClass = `flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left ${on ? "bg-sunken" : ""}`;
                  if (choice.kind === "path") {
                    return (
                      <button key="path" type="button" role="option" aria-selected={on} data-active={on} onMouseEnter={() => setActive(i)} onClick={() => void pick(choice)} className={rowClass}>
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{choice.path}</span>
                        {busy === "path" ? <Spinner size={11} /> : <span className="text-[11px] text-faint">Use this folder</span>}
                      </button>
                    );
                  }
                  if (choice.kind === "local") {
                    const r = choice.repo;
                    const selected = r.path === value;
                    return (
                      <button key={r.path} type="button" role="option" aria-selected={on} data-active={on} onMouseEnter={() => setActive(i)} onClick={() => void pick(choice)} className={rowClass}>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={`truncate text-[12.5px] ${selected ? "font-medium text-accent" : "text-ink"}`}>{r.name}</span>
                            {r.branch && (
                              <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-muted">
                                <Icon name="branch" size={10} />
                                {r.branch}
                              </span>
                            )}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-faint">
                            {r.github ?? shortPath(r.path, home)}
                          </span>
                        </span>
                        {selected && <Icon name="check" size={13} className="text-accent" />}
                      </button>
                    );
                  }
                  if (choice.kind === "github") {
                    const r = choice.repo;
                    const cloning = busy === r.fullName;
                    return (
                      <button key={r.fullName} type="button" role="option" aria-selected={on} data-active={on} disabled={Boolean(busy)} onMouseEnter={() => setActive(i)} onClick={() => void pick(choice)} className={`${rowClass} disabled:opacity-70`}>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[12.5px] text-ink">{r.fullName}</span>
                            {r.private && <span className="shrink-0 rounded border border-line-strong px-1 text-[10px] text-muted">private</span>}
                          </span>
                          {r.description && <span className="block truncate text-[11px] text-faint">{r.description}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
                          {cloning ? (
                            <>
                              <Spinner size={11} /> Cloning…
                            </>
                          ) : (
                            <>
                              <Icon name="download" size={11} /> Clone to ~/dev
                            </>
                          )}
                        </span>
                      </button>
                    );
                  }
                  return null;
                })}
              </div>
            ))}
            {local !== null && sections.length === 0 && (
              <p className="px-2.5 py-2 text-[12px] text-muted">Nothing matches “{q}”.</p>
            )}
            {open && !github && !githubError && (
              <p className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] text-faint">
                <Spinner size={10} /> Loading your GitHub repos…
              </p>
            )}
            {githubError && <p className="px-2.5 py-1.5 text-[11.5px] text-faint">GitHub: {githubError}</p>}
          </div>

          <div className="shrink-0 border-t border-line p-1">
            {(() => {
              index++;
              const on = index === active;
              const browse = flat.length - 1;
              return (
                <button
                  type="button"
                  data-active={on}
                  onMouseEnter={() => setActive(browse)}
                  onClick={() => void pick({ kind: "browse" })}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink ${on ? "bg-sunken" : ""}`}
                >
                  {busy === "browse" ? <Spinner size={12} /> : <Icon name="folder" size={13} className="text-muted" />}
                  Browse for a folder…
                </button>
              );
            })()}
            {error && <p className="px-2.5 pb-1.5 pt-1 text-[12px] text-danger">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
