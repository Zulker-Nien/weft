"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { type Choice, buildSections, errorText } from "@/lib/repo-picker";
import type { GithubRepo, LocalRepo } from "@/lib/types";
import Icon, { Spinner } from "./Icon";
import NewProjectForm from "./NewProjectForm";
import RepoChoiceRow from "./RepoChoiceRow";
import RepoPickerButton, { PickerRow } from "./RepoPickerButton";

// Where a new thread runs: a recent project, a git repo on this Mac, a GitHub repo (cloned into
// ~/dev on the spot), a new empty project in ~/dev, a folder from the Finder, or a pasted path.

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
  const [naming, setNaming] = useState(false);
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
      .catch((err: unknown) => setGithubError(errorText(err)));
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

  const sections = useMemo(() => buildSections(q, local, github), [q, local, github]);

  const flat = useMemo<Choice[]>(() => [...sections.flatMap((s) => s.choices), { kind: "new" }, { kind: "browse" }], [sections]);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function show() {
    setQuery("");
    setActive(0);
    setError(null);
    setNaming(false);
    setOpen(true);
  }

  async function pick(choice: Choice) {
    setError(null);
    try {
      if (choice.kind === "new") {
        setNaming(true);
        return;
      }
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
        const bridge = window.weft;
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
      <RepoPickerButton value={value} home={home} current={current} open={open} onClick={() => (open ? setOpen(false) : show())} />

      {open && (
        <div
          onKeyDown={naming ? undefined : onKeyDown}
          className="absolute bottom-full left-0 z-50 mb-1.5 flex max-h-[min(460px,60vh)] w-[min(480px,calc(100vw-48px))] flex-col rounded-lg border border-line bg-panel shadow-2xl"
        >
          {naming ? (
            <NewProjectForm
              parent={`${home}/dev`}
              shownParent="~/dev"
              initialName={q.replace(/\s+/g, "-")}
              onCreated={(path) => {
                onChange(path);
                setOpen(false);
              }}
              onBack={() => setNaming(false)}
            />
          ) : (
            <>
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
                  return (
                    <RepoChoiceRow
                      key={choice.kind === "path" ? "path" : choice.kind === "local" ? choice.repo.path : choice.kind === "github" ? choice.repo.fullName : i}
                      choice={choice}
                      on={i === active}
                      busy={busy}
                      value={value}
                      home={home}
                      onHover={() => setActive(i)}
                      onPick={() => void pick(choice)}
                    />
                  );
                })}
              </div>
            ))}
            {local !== null && sections.length === 0 && (
              <p className="px-2.5 py-2 text-[12px] text-muted">Nothing matches “{q}”.</p>
            )}
            {!github && !githubError && (
              <p className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] text-faint">
                <Spinner size={10} /> Loading your GitHub repos…
              </p>
            )}
            {githubError && <p className="px-2.5 py-1.5 text-[11.5px] text-faint">GitHub: {githubError}</p>}
          </div>

          <div className="shrink-0 border-t border-line p-1">
            <PickerRow active={active === flat.length - 2} icon={<Icon name="plus" size={13} className="text-muted" />} onHover={() => setActive(flat.length - 2)} onClick={() => void pick({ kind: "new" })}>
              New project…
            </PickerRow>
            <PickerRow active={active === flat.length - 1} icon={busy === "browse" ? <Spinner size={12} /> : <Icon name="folder" size={13} className="text-muted" />} onHover={() => setActive(flat.length - 1)} onClick={() => void pick({ kind: "browse" })}>
              Browse for a folder…
            </PickerRow>
            {error && <p className="px-2.5 pb-1.5 pt-1 text-[12px] text-danger">{error}</p>}
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
