// The "/" typeahead's floating list of skills: the user picks one with click or arrow keys; the
// highlighted row follows the user's arrow key but resets when a new query starts.
import { useEffect, useRef } from "react";
import type { SkillInfo } from "@/lib/types";

export default function SkillTypeahead({
  skills,
  active,
  above,
  onPick,
  onHover,
}: {
  skills: SkillInfo[];
  active: number;
  above: boolean;
  onPick: (skill: SkillInfo) => void;
  onHover: (i: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Skills"
      className={`absolute z-40 max-h-[260px] overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-lg ${
        above ? "inset-x-0 bottom-full mb-1.5" : "inset-x-2 bottom-11"
      }`}
    >
      {skills.map((skill, i) => (
        <button
          key={skill.name}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(skill)}
          className={`block w-full rounded-md px-2.5 py-1.5 text-left ${i === active ? "bg-sunken" : ""}`}
        >
          <span className="block font-mono text-[12.5px] text-ink">/{skill.name}</span>
          {skill.description && (
            <span className="line-clamp-1 text-[11.5px] leading-snug text-muted">{skill.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}
