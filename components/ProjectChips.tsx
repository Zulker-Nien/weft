// The horizontal row of project chips in the project bar — "All", the recent six, and the selected
// project if it isn't one of them. Scrolls horizontally and keeps the selected chip in view.
import { type RefObject } from "react";
import { folderName, shortPath, statusLabel } from "@/lib/project-bar";
import ProjectStatusDot from "./ProjectStatusDot";
import type { ProjectSummary } from "@/lib/board-view";

const CHIP = "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px]";
const CHIP_ON = "border-accent bg-accent-soft text-accent";
const CHIP_OFF = "border-line-strong text-ink hover:bg-sunken";

// How many of the most recent projects get a chip; the rest are under "More".
const RECENT_CHIPS = 6;

export default function ProjectChips({
  projects,
  total,
  selected,
  onSelect,
  home,
  chipsRef,
  stepHint,
}: {
  projects: ProjectSummary[]; // already sorted, most recent first
  total: number; // total card count, for the "All" chip
  selected: string | null; // selected project path, null = all projects
  onSelect: (path: string | null) => void;
  home: string;
  chipsRef: RefObject<HTMLDivElement | null>;
  stepHint: string; // appended to chip titles, e.g. "← → step through projects"
}) {
  // A project picked from "More" (or just added) that isn't one of the recent six still gets a chip,
  // so the current filter is always visible.
  const recent = projects.slice(0, RECENT_CHIPS);
  const extra =
    selected && !recent.some((p) => p.path === selected)
      ? (projects.find((p) => p.path === selected) ?? { path: selected, lastActivity: 0, cards: 0, running: 0, needsYou: 0 })
      : null;
  const chips = extra ? [...recent, extra] : recent;

  return (
    <div ref={chipsRef} className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:thin]">
      <button
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        title={`All projects${stepHint}`}
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
            title={`${shortPath(project.path, home)}${stepHint}`}
            className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
          >
            <ProjectStatusDot project={project} />
            <span className="max-w-[160px] truncate">{folderName(project.path)}</span>
            <span className={`tabular-nums ${on ? "text-accent/70" : "text-faint"}`}>{project.cards}</span>
            <span className="sr-only">{statusLabel(project)}</span>
          </button>
        );
      })}
    </div>
  );
}
