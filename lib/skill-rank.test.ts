import { describe, expect, it } from "vitest";
import { rankSkills } from "./skill-rank";
import type { SkillInfo } from "./types";

const skill = (name: string, description = ""): SkillInfo => ({ name, description, source: "user" });
const names = (list: SkillInfo[]) => list.map((s) => s.name);

const SKILLS = [skill("weft:commit", "Stage and commit"), skill("commit", "Conventional commits"), skill("deploy", "Ship it, then commit the tag"), skill("lint-fix")];

describe("rankSkills", () => {
  it("offers every skill before anything is typed", () => {
    expect(rankSkills(SKILLS, "")).toBe(SKILLS);
  });

  it("puts names that start with the query first, then names and descriptions that contain it", () => {
    expect(names(rankSkills(SKILLS, "Com"))).toEqual(["commit", "weft:commit", "deploy"]);
  });

  it("drops skills that don't match", () => {
    expect(names(rankSkills(SKILLS, "lint"))).toEqual(["lint-fix"]);
    expect(rankSkills(SKILLS, "zzz")).toEqual([]);
  });
});
