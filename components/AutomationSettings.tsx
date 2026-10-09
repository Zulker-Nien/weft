"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/client";
import { AUTOMATION_TRIGGERS, type Automation, type AutomationTrigger, type SkillInfo } from "@/lib/types";
import Icon, { Spinner } from "./Icon";
import { SKILL_SOURCES } from "./SkillMenu";

function validPattern(source: string) {
  try {
    new RegExp(source, "i");
    return true;
  } catch {
    return false;
  }
}

const FIELD =
  "rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent";

// The Settings section for board automations ("when <trigger>, run <skill>") and the skills they can use.
export default function AutomationSettings({
  rules,
  onChange,
}: {
  rules: Automation[];
  onChange: (rules: Automation[]) => void;
}) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    let ignore = false;
    api.skills().then(
      (r) => !ignore && setSkills(r.skills),
      (err) => !ignore && setLoadError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      ignore = true;
    };
  }, []);

  const known = new Set(skills?.map((s) => s.name));
  const update = (id: string, patch: Partial<Automation>) =>
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">Skills and automations</h3>
        <p className="text-[12.5px] text-muted">
          Run a skill in a card&apos;s thread when the thread starts, when you move the card, or when a prompt you send
          matches a pattern (once per thread). Moves only run skills on cards that have already run, and only your own
          moves count, not the copilot&apos;s or a thread&apos;s own status.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {rules.length === 0 && <p className="text-[12.5px] text-faint">No automations. Cards only run what you send them.</p>}
        {rules.map((rule) => {
          const skill = rule.skill.trim().replace(/^\//, "");
          const matches = rule.on === "prompt-matches";
          // Settings can't import lib/automations (it reads ~/.weft), so the pattern is checked here.
          const badPattern = matches && Boolean(rule.pattern?.trim()) && !validPattern(rule.pattern ?? "");
          const unknown = skills !== null && skill !== "" && !known.has(skill);
          return (
            <div key={rule.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <span className="shrink-0">When</span>
                <select
                  value={rule.on}
                  aria-label="When"
                  onChange={(e) => update(rule.id, { on: e.target.value as AutomationTrigger })}
                  className={`${FIELD} min-w-0`}
                >
                  {AUTOMATION_TRIGGERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {matches && (
                  <input
                    value={rule.pattern ?? ""}
                    spellCheck={false}
                    placeholder="vercel|deploy"
                    aria-label="Pattern"
                    aria-invalid={badPattern}
                    title={badPattern ? "Not a valid regular expression" : "Regular expression, ignoring case"}
                    onChange={(e) => update(rule.id, { pattern: e.target.value })}
                    className={`${FIELD} min-w-0 flex-1 font-mono ${badPattern ? "border-danger" : ""}`}
                  />
                )}
                <span className="shrink-0">run</span>
                <input
                  value={rule.skill}
                  list={listId}
                  spellCheck={false}
                  placeholder="weft:done"
                  aria-label="Skill"
                  onChange={(e) => update(rule.id, { skill: e.target.value })}
                  className={`${FIELD} min-w-0 flex-1 font-mono`}
                />
                <button
                  onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}
                  title="Remove automation"
                  aria-label="Remove automation"
                  className="shrink-0 rounded-md p-1.5 text-muted hover:bg-sunken hover:text-danger"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              {unknown && (
                <p className="pl-[42px] text-[11.5px] text-warn">
                  Not one of Weft&apos;s skills or yours, so it only runs in projects that have it.
                </p>
              )}
            </div>
          );
        })}
        <button
          onClick={() => onChange([...rules, { id: crypto.randomUUID(), on: "done", skill: "" }])}
          className="flex w-fit items-center gap-1 text-[12.5px] text-accent hover:underline"
        >
          <Icon name="plus" size={12} /> Add automation
        </button>
      </div>

      <datalist id={listId}>
        {skills?.map((s) => (
          <option key={s.name} value={s.name}>
            {s.description}
          </option>
        ))}
      </datalist>

      <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-line px-3 py-2.5">
        {skills === null && loadError === null && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Spinner size={12} /> Finding skills
          </div>
        )}
        {loadError && <p className="text-[12px] text-danger">Couldn&apos;t list skills: {loadError}</p>}
        {skills &&
          SKILL_SOURCES.map((source) => {
            const group = skills.filter((s) => s.source === source.id);
            if (!group.length) return null;
            const list = group.map((s) => (
              <li key={s.name} className="flex gap-3 text-[12px]">
                <span className="w-[120px] shrink-0 truncate font-mono text-ink" title={`/${s.name}`}>
                  /{s.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted" title={s.description}>
                  {s.description}
                </span>
              </li>
            ));
            // Weft's own are few and the point of this list; yours can run to dozens, so they fold.
            return source.id === "weft" ? (
              <div key={source.id} className="flex flex-col gap-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Weft&apos;s skills</p>
                <ul className="flex flex-col gap-1">{list}</ul>
              </div>
            ) : (
              <details key={source.id} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-faint">
                  <Icon name="chevronDown" size={11} className="-rotate-90 transition-transform group-open:rotate-0" />
                  {source.label} · {group.length}
                </summary>
                <ul className="mt-1 flex flex-col gap-1">{list}</ul>
              </details>
            );
          })}
        <p className="text-[11.5px] text-faint">
          Weft&apos;s skills ship in its plugin folder and run as /weft:&lt;name&gt;. Yours come from ~/.claude/skills.
          A card&apos;s Skills button also lists its project&apos;s own.
        </p>
      </div>
    </section>
  );
}
