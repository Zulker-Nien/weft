// What the repo picker lists: the choices a row can make, word matching, and the sections built
// from the local repos, the GitHub repos and the typed query.
import type { IconName } from "@/components/Icon";
import type { GithubRepo, LocalRepo } from "./types";

export type Choice =
  | { kind: "local"; repo: LocalRepo }
  | { kind: "github"; repo: GithubRepo }
  | { kind: "path"; path: string }
  | { kind: "new" }
  | { kind: "browse" };

export function matches(query: string, ...fields: (string | undefined)[]) {
  if (!query) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export type Section = { title: string; icon: IconName; choices: Choice[] };

export function buildSections(q: string, local: LocalRepo[] | null, github: GithubRepo[] | null): Section[] {
  const out: Section[] = [];
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
}
