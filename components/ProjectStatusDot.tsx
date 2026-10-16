// Warn (needs you) wins over accent (running) — the colored dot on a project's chip.
import type { ProjectSummary } from "@/lib/board-view";

export default function ProjectStatusDot({ project }: { project: ProjectSummary }) {
  if (project.needsYou > 0) return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />;
  if (project.running > 0) return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />;
  return null;
}
