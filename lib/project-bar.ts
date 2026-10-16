// Display helpers for the project bar: the folder name and a path shortened with the home dir. Pure,
// so the bar component and the command palette can share the same rules.
import type { ProjectSummary } from "./board-view";

// "/Users/me/dev/app/" -> "app": the chip's label, ignoring any trailing slashes.
export function folderName(folder: string) {
  const trimmed = folder.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || folder;
}

// "/Users/me/dev/app" with home "/Users/me" -> "~/dev/app"
export function shortPath(folder: string, home: string) {
  if (home && (folder === home || folder.startsWith(`${home}/`))) return `~${folder.slice(home.length)}`;
  return folder;
}

// "1 card" / "5 cards", for the menu and the chips' counts.
export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

// What a project's status dot should say for screen readers: "N needs you" and "M running".
export function statusLabel(project: ProjectSummary) {
  const parts: string[] = [];
  if (project.needsYou > 0) parts.push(`${project.needsYou} ${project.needsYou === 1 ? "needs" : "need"} you`);
  if (project.running > 0) parts.push(`${project.running} running`);
  return parts.length ? `, ${parts.join(", ")}` : "";
}
