import type { TeamOrg, TeamRole } from "./team-types";

// Which workspace Settings → Team opens on: the one you last picked, kept in localStorage between opens.
export const TEAM_ORG_KEY = "weft-team-org";

export function readSavedOrg(): string | undefined {
  try {
    return window.localStorage.getItem(TEAM_ORG_KEY) || undefined;
  } catch {
    return undefined;
  }
}

// undefined forgets the pick, so the server's default workspace shows again.
export function saveOrg(slug: string | undefined): void {
  try {
    if (slug) window.localStorage.setItem(TEAM_ORG_KEY, slug);
    else window.localStorage.removeItem(TEAM_ORG_KEY);
  } catch {
    // Private mode or no storage: the pick just doesn't last.
  }
}

// A remembered slug the account no longer has (left the team, team deleted) falls back to the server default.
export function stillListed(slug: string | undefined, orgs: TeamOrg[]): boolean {
  return !slug || orgs.some((o) => o.slug === slug);
}

// "Acme (Owner)" for the switcher's options.
export function orgLabel(org: TeamOrg, roleLabels: Record<TeamRole, string>): string {
  return org.role ? `${org.name} · ${roleLabels[org.role]}` : org.name;
}

// The repos of the board's projects that aren't linked to the team yet, sorted.
export function unlinkedRepos(boardRepos: string[], linked: string[]): string[] {
  const have = new Set(linked.map((r) => r.toLowerCase()));
  return [...new Set(boardRepos)].filter((r) => !have.has(r.toLowerCase())).sort();
}
