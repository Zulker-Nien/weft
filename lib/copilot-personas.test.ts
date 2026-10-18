import { describe, expect, it } from "vitest";
import { isPersona, PERSONA_ORDER, PERSONA_PROMPTS, PERSONAS, personaOf } from "./copilot-personas";

describe("copilot personas", () => {
  it("knows the three personas and nothing else", () => {
    expect(PERSONA_ORDER).toEqual(["wingman", "founder", "captain"]);
    for (const id of PERSONA_ORDER) expect(isPersona(id)).toBe(true);
    for (const other of ["", "toString", "ceo", 3, undefined, null]) expect(isPersona(other)).toBe(false);
  });

  it("falls back to Wingman for a copilot made before personas, or an unknown one", () => {
    expect(personaOf(undefined).id).toBe("wingman");
    expect(personaOf("pirate").id).toBe("wingman");
    expect(personaOf("captain").name).toBe("Captain");
  });

  it("adds nothing to Wingman's prompt and a method to the others, credited", () => {
    expect(PERSONAS.wingman.prompt).toBe("");
    expect(PERSONAS.founder.prompt).toContain("founder-skill");
    expect(PERSONAS.founder.prompt).toContain("never a guess");
    expect(PERSONAS.captain.prompt).toContain("gstack");
    expect(PERSONAS.captain.prompt).toContain("Think → Plan → Build → Review → Test → Ship → Reflect");
  });

  it("fingerprints every persona's prompt", () => {
    for (const id of PERSONA_ORDER) expect(PERSONA_PROMPTS).toContain(PERSONAS[id].prompt);
  });
});
