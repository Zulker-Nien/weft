import type { SkillInfo } from "./types";

// The skills the Composer's "/" typeahead offers for what you've typed: names that start with it first,
// then names or descriptions that contain it.
export function rankSkills(skills: SkillInfo[], query: string) {
  const q = query.toLowerCase();
  if (!q) return skills;
  const starts = skills.filter((s) => s.name.toLowerCase().startsWith(q));
  const rest = skills.filter(
    (s) => !starts.includes(s) && (s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)),
  );
  return [...starts, ...rest];
}
