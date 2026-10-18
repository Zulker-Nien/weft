import type { GithubPerson } from "./github-collaborators";

// The People on your projects list: who to suggest, how many to show.

export const PEOPLE_SHOWN = 5;

// Drop anyone already a member or invited (by email, case-insensitive); people with no known email stay.
export function suggestPeople(
  people: GithubPerson[],
  members: { email: string | null }[],
  pending: { email: string }[],
): GithubPerson[] {
  const taken = new Set<string>();
  for (const m of members) if (m.email) taken.add(m.email.trim().toLowerCase());
  for (const p of pending) taken.add(p.email.trim().toLowerCase());
  return people.filter((p) => !p.email || !taken.has(p.email.trim().toLowerCase()));
}

export function visiblePeople<T>(people: T[], showAll: boolean): { shown: T[]; hidden: number } {
  if (showAll || people.length <= PEOPLE_SHOWN) return { shown: people, hidden: 0 };
  return { shown: people.slice(0, PEOPLE_SHOWN), hidden: people.length - PEOPLE_SHOWN };
}

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
