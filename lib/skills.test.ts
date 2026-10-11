import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Weft's plugin folder, the home folder and a project each get their own temp dir before the import.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-skills-"));
const pluginDir = path.join(root, "plugin");
const home = path.join(root, "home");
const project = path.join(root, "project");
process.env.WEFT_PLUGIN_DIR = pluginDir;
process.env.HOME = home;

const { listSkills, PLUGIN_DIR, SKILL_NAME } = await import("./skills");

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  for (const dir of [pluginDir, home, project]) fs.rmSync(dir, { recursive: true, force: true });
});

function skill(dir: string, name: string, text: string) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), text);
}
const weftSkills = () => path.join(pluginDir, "skills");
const userSkills = () => path.join(home, ".claude", "skills");
const projectSkills = () => path.join(project, ".claude", "skills");

describe("PLUGIN_DIR and SKILL_NAME", () => {
  it("takes the plugin folder from WEFT_PLUGIN_DIR", () => {
    expect(PLUGIN_DIR).toBe(pluginDir);
  });

  it("defaults to plugin/ in the working directory", async () => {
    vi.resetModules();
    vi.stubEnv("WEFT_PLUGIN_DIR", "");
    expect((await import("./skills")).PLUGIN_DIR).toBe(path.join(process.cwd(), "plugin"));
    vi.unstubAllEnvs();
  });

  it("accepts a plain or plugin-scoped skill name and nothing else", () => {
    for (const ok of ["done", "weft:done", "a.b-c_d", "x:y.z"]) expect(SKILL_NAME.test(ok), ok).toBe(true);
    for (const bad of ["", ":done", "weft:", "a:b:c", "has space", "a/b"]) expect(SKILL_NAME.test(bad), bad).toBe(false);
  });
});

describe("listSkills", () => {
  it("is empty when no skill folders exist", () => {
    expect(listSkills()).toEqual([]);
    expect(listSkills(project)).toEqual([]);
  });

  it("prefixes Weft's skills with weft: and sorts each source by name", () => {
    skill(weftSkills(), "preview", "---\nname: preview\ndescription: Start the dev server\n---\nBody");
    skill(weftSkills(), "done", "---\nname: done\ndescription: Wrap up\n---\n");
    expect(listSkills()).toEqual([
      { name: "weft:done", description: "Wrap up", source: "weft" },
      { name: "weft:preview", description: "Start the dev server", source: "weft" },
    ]);
  });

  it("lists Weft's, then the project's, then the user's skills", () => {
    skill(weftSkills(), "done", "---\ndescription: w\n---\n");
    skill(userSkills(), "mine", "---\ndescription: u\n---\n");
    skill(projectSkills(), "local", "---\ndescription: p\n---\n");
    expect(listSkills(project).map((s) => [s.name, s.source])).toEqual([
      ["weft:done", "weft"],
      ["local", "project"],
      ["mine", "user"],
    ]);
  });

  it("skips the project's skills when no folder is given", () => {
    skill(projectSkills(), "local", "---\ndescription: p\n---\n");
    expect(listSkills()).toEqual([]);
  });

  it("lets a project skill hide a personal one with the same name", () => {
    skill(userSkills(), "deploy", "---\ndescription: mine\n---\n");
    skill(userSkills(), "other", "---\ndescription: kept\n---\n");
    skill(projectSkills(), "deploy", "---\ndescription: theirs\n---\n");
    expect(listSkills(project)).toEqual([
      { name: "deploy", description: "theirs", source: "project" },
      { name: "other", description: "kept", source: "user" },
    ]);
  });

  it("skips dot folders and folders without a SKILL.md", () => {
    skill(userSkills(), ".hidden", "---\ndescription: no\n---\n");
    fs.mkdirSync(path.join(userSkills(), "empty"), { recursive: true });
    fs.writeFileSync(path.join(userSkills(), "loose.md"), "not a skill folder");
    skill(userSkills(), "real", "---\ndescription: yes\n---\n");
    expect(listSkills().map((s) => s.name)).toEqual(["real"]);
  });

  it("falls back to the folder name when the frontmatter has no name", () => {
    skill(userSkills(), "folder-name", "---\ndescription: d\n---\n");
    skill(userSkills(), "other-folder", "---\nname: named\ndescription: d\n---\n");
    expect(listSkills().map((s) => s.name)).toEqual(["folder-name", "named"]);
  });
});

describe("skill descriptions", () => {
  const describeOf = (text: string) => {
    skill(userSkills(), "s", text);
    return listSkills()[0]!.description;
  };

  it("strips matching quotes from a value", () => {
    expect(describeOf(`---\ndescription: "Quoted: yes"\n---\n`)).toBe("Quoted: yes");
    expect(describeOf(`---\ndescription: 'single'\n---\n`)).toBe("single");
    expect(describeOf(`---\ndescription: "mismatched'\n---\n`)).toBe(`"mismatched'`);
  });

  it("joins folded and block values onto one line", () => {
    expect(describeOf("---\ndescription: >\n  Line one\n  line two\nname: s\n---\n")).toBe("Line one line two");
    expect(describeOf("---\ndescription: |-\n  First\n\n  Second\n---\n")).toBe("First  Second");
  });

  it("reads an indented block under an empty value", () => {
    expect(describeOf("---\ndescription:\n  Wrapped\n  text\n---\n")).toBe("Wrapped text");
  });

  it("ignores frontmatter lines that aren't fields", () => {
    expect(describeOf("---\n# comment\n- item\ndescription: ok\n---\n")).toBe("ok");
  });

  it("handles CRLF line endings", () => {
    expect(describeOf("---\r\nname: s\r\ndescription: Windows\r\n---\r\nBody")).toBe("Windows");
  });

  it("uses the first line of text after any heading when there's no description", () => {
    expect(describeOf("---\nname: s\n---\n# Title\n\n  First real line  \nmore")).toBe("First real line");
    expect(describeOf("# Only a title\nThen text")).toBe("Then text");
  });

  it("is empty when there's no description and no text", () => {
    expect(describeOf("---\nname: s\n---\n# Heading only\n")).toBe("");
  });

  it("cuts a long description to 240 characters with an ellipsis", () => {
    const long = "x".repeat(300);
    const cut = describeOf(`---\ndescription: ${long}\n---\n`);
    expect(cut).toHaveLength(240);
    expect(cut.endsWith("…")).toBe(true);
    expect(describeOf(`---\ndescription: ${"y".repeat(240)}\n---\n`)).toBe("y".repeat(240));
  });
});
