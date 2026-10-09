"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { SkillInfo } from "@/lib/types";
import Icon, { Spinner } from "./Icon";

export const SKILL_SOURCES: { id: SkillInfo["source"]; label: string }[] = [
  { id: "weft", label: "Weft" },
  { id: "project", label: "This project" },
  { id: "user", label: "Yours" },
];

type Load = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; skills: SkillInfo[] };

// A card's Skills button: lists the skills its thread can run and sends the chosen one as /<skill>.
export default function SkillMenu({
  cwd,
  disabled,
  onRun,
}: {
  cwd: string;
  disabled: boolean;
  onRun: (skill: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [filter, setFilter] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    api.skills(cwd).then(
      (r) => !ignore && setLoad({ kind: "ready", skills: r.skills }),
      (err) => !ignore && setLoad({ kind: "error", error: err instanceof Error ? err.message : String(err) }),
    );
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      ignore = true;
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, cwd]);

  function toggle() {
    setFilter("");
    setError(null);
    setLoad({ kind: "loading" });
    setOpen((o) => !o);
  }

  async function run(skill: string) {
    setRunning(skill);
    setError(null);
    try {
      await onRun(skill);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  }

  const needle = filter.trim().toLowerCase();
  const shown =
    load.kind === "ready"
      ? load.skills.filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle))
      : [];

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={toggle}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={disabled ? "Wait for this turn to finish to run a skill" : "Run a skill in this thread"}
        className="flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-40"
      >
        Skills
        <Icon name="chevronDown" size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-full z-40 mt-1.5 flex max-h-[min(480px,calc(100vh-120px))] w-[340px] flex-col rounded-lg border border-line bg-panel shadow-lg"
        >
          <div className="shrink-0 border-b border-line p-2">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown[0] && !running) void run(shown[0].name);
              }}
              placeholder="Find a skill"
              aria-label="Find a skill"
              className="w-full rounded-md border border-line-strong bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent"
            />
          </div>

          <div className="min-h-0 overflow-y-auto p-1">
            {load.kind === "loading" && (
              <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-muted">
                <Spinner size={12} /> Finding skills
              </div>
            )}
            {load.kind === "error" && <p className="px-2.5 py-2 text-[12px] text-danger">{load.error}</p>}
            {load.kind === "ready" && shown.length === 0 && (
              <p className="px-2.5 py-2 text-[12px] text-muted">No skills match.</p>
            )}
            {SKILL_SOURCES.map((source) => {
              const group = shown.filter((s) => s.source === source.id);
              if (!group.length) return null;
              return (
                <div key={source.id} className="pb-1">
                  <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{source.label}</p>
                  {group.map((skill) => (
                    <button
                      key={skill.name}
                      onClick={() => void run(skill.name)}
                      disabled={running !== null}
                      className="flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-sunken disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[12.5px] text-ink">/{skill.name}</span>
                        {skill.description && (
                          <span className="line-clamp-2 block text-[11.5px] leading-snug text-muted">{skill.description}</span>
                        )}
                      </span>
                      {running === skill.name && <Spinner size={12} />}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <p className="shrink-0 border-t border-line px-3 py-2 text-[11.5px] text-faint">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : (
              "Runs it in this thread. To run skills on their own, add automations in Settings."
            )}
          </p>
        </div>
      )}
    </div>
  );
}
