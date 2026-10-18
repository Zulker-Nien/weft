import { describe, expect, it } from "vitest";
import type { Card } from "./types";
import {
  asText,
  cacheMinutesLeft,
  clip,
  describeToolRun,
  firstLine,
  folderName,
  projectHue,
  formatReset,
  formatTokens,
  isLive,
  shortToolName,
  cleanTitle,
  STAGES,
  stageStep,
  summarizeInput,
  timeAgo,
  titleFromPrompt,
  titleWords,
  toolAction,
  worktreeParent,
} from "./format";

describe("isLive", () => {
  it("is live while running or waiting on a permission", () => {
    expect(isLive({ column: "running" } as Card)).toBe(true);
    expect(isLive({ column: "needs_you", pending: { id: "p" } } as unknown as Card)).toBe(true);
    expect(isLive({ column: "needs_you", pending: null } as Card)).toBe(false);
    expect(isLive({ column: "review" } as Card)).toBe(false);
  });
});

describe("names and paths", () => {
  it("shortens mcp tool names", () => {
    expect(shortToolName("mcp__browser__click")).toBe("browser click");
    expect(shortToolName("Bash")).toBe("Bash");
  });

  it("takes the last folder", () => {
    expect(folderName("/Users/me/dev/weft")).toBe("weft");
    expect(folderName("/Users/me/dev/weft/")).toBe("weft");
    expect(folderName("/")).toBe("/");
  });

  it("finds the repo a worktree folder belongs to", () => {
    expect(worktreeParent("/me/app/.claude/worktrees/eager-x/src")).toBe("/me/app");
    expect(worktreeParent("/me/app/.claude/worktrees/eager-x")).toBe("/me/app");
    expect(worktreeParent("/me/app")).toBeUndefined();
    expect(worktreeParent("/me/app/.claude/worktrees/")).toBeUndefined();
  });
});

describe("numbers and times", () => {
  it("formats tokens", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });

  it("says how long ago", () => {
    const now = 10_000_000_000;
    expect(timeAgo(now - 5_000, now)).toBe("just now");
    expect(timeAgo(now + 5_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(timeAgo(now - 3 * 3600_000, now)).toBe("3h ago");
    expect(timeAgo(now - 2 * 86400_000, now)).toBe("2d ago");
  });

  it("formats a quota reset time, with the weekday when it is far off", () => {
    const now = new Date(2026, 9, 9, 8, 0).getTime();
    const soon = new Date(2026, 9, 9, 23, 6).getTime() / 1000;
    expect(formatReset(soon, now)).toBe("11:06pm");
    const later = new Date(2026, 9, 12, 14, 0).getTime() / 1000;
    expect(formatReset(later, now)).toBe("mon 2:00pm");
  });
});

describe("toolAction", () => {
  it("names built-in tools", () => {
    expect(toolAction("Bash")).toBe("command");
    expect(toolAction("MultiEdit")).toBe("edit");
    expect(toolAction("Glob")).toBe("search");
    expect(toolAction("Agent")).toBe("agent");
  });

  it("keeps unknown tools and mcp servers identifiable", () => {
    expect(toolAction("Frobnicate")).toBe("use:Frobnicate");
    expect(toolAction("mcp__board__move_card")).toBe("mcp:board__move_card");
  });

  it("maps browser tools from any server to one vocabulary", () => {
    expect(toolAction("mcp__browser__click")).toBe("click");
    expect(toolAction("mcp__browser__open_url")).toBe("open");
    expect(toolAction("mcp__browser__screenshot")).toBe("screenshot");
    expect(toolAction("mcp__browser__type_text")).toBe("type");
    expect(toolAction("mcp__browser__read_page")).toBe("look");
    expect(toolAction("mcp__browser__mystery")).toBe("browser");
    expect(toolAction("mcp__computer__computer", { action: "scroll_down" })).toBe("scroll");
    expect(toolAction("mcp__chrome__computer", { action: "key" })).toBe("key");
  });
});

describe("describeToolRun", () => {
  it("counts files by target, other calls by number", () => {
    const run = describeToolRun([
      { action: "edit", target: "a.ts" },
      { action: "edit", target: "a.ts" },
      { action: "command" },
      { action: "command" },
    ]);
    expect(run).toEqual({ text: "Edited a file, ran 2 commands", more: 0 });
  });

  it("counts distinct files", () => {
    expect(describeToolRun([{ action: "read", target: "a" }, { action: "read", target: "b" }]).text).toBe("Read 2 files");
  });

  it("limits phrases and reports the rest", () => {
    const run = describeToolRun(["read", "edit", "write", "command", "web"].map((action) => ({ action })));
    expect(run.text).toBe("Read a file, edited a file, wrote a file");
    expect(run.more).toBe(2);
  });

  it("describes mcp and unknown kinds", () => {
    expect(describeToolRun([{ action: "mcp:board__move_card" }]).text).toBe("Used board");
    expect(describeToolRun([{ action: "mcp:plugin_vercel_vercel__deploy" }, { action: "mcp:plugin_vercel_vercel__list" }]).text).toBe("Used vercel, used vercel");
    // Two tools of one server are two kinds, so the server name repeats (a cosmetic wart, pinned here).
    expect(describeToolRun([{ action: "mcp:board__a" }, { action: "mcp:board__a" }]).text).toBe("Used board 2 times");
    expect(describeToolRun([{ action: "mcp:0123abcd-1111__x" }]).text).toBe("Used x");
    expect(describeToolRun([{ action: "use:Frobnicate" }]).text).toBe("Used Frobnicate");
  });

  it("handles an empty run", () => {
    expect(describeToolRun([])).toEqual({ text: "", more: 0 });
  });
});

describe("titleFromPrompt", () => {
  it("uses the first line with words, minus markdown", () => {
    expect(titleFromPrompt("# Fix the **login** bug\nmore")).toBe("Fix the login bug");
    expect(titleFromPrompt("- [ ] add [docs](http://x) now")).toBe("add docs now");
    expect(titleFromPrompt("```\n---\n\nreal line")).toBe("real line");
  });

  it("keeps every word of a first line that fits", () => {
    expect(titleFromPrompt("Fix the build so tests pass cleanly")).toBe("Fix the build so tests pass cleanly");
  });

  it("truncates a long title to its byte cap", () => {
    const title = titleFromPrompt("🐞 " + "word ".repeat(40), 20);
    expect(title.length).toBe(20);
    expect(title.endsWith("…")).toBe(true);
  });

  it("names a media-only prompt after its file, else a default", () => {
    expect(titleFromPrompt("![shot.png](/tmp/shot.png)")).toBe("Look at shot.png");
    expect(titleFromPrompt("   \n")).toBe("New thread");
  });
});

describe("cleanTitle", () => {
  it("keeps every word, on one line", () => {
    expect(cleanTitle("Fix the build so tests pass cleanly")).toBe("Fix the build so tests pass cleanly");
    expect(cleanTitle("  🐞 Compile Error:\n missing   import ")).toBe("🐞 Compile Error: missing import");
  });

  it("clips a pasted paragraph at 80 characters", () => {
    const title = cleanTitle("word ".repeat(40));
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("returns an empty string for empty input", () => {
    expect(cleanTitle("")).toBe("");
    expect(cleanTitle("   ")).toBe("");
  });
});

describe("titleWords", () => {
  it("counts the words after a leading emoji", () => {
    expect(titleWords("🐞 Compile Error: missing import")).toBe(4);
    expect(titleWords("Add dark mode toggle")).toBe(4);
    expect(titleWords("  ")).toBe(0);
  });
});

describe("asText", () => {
  it("keeps strings, spells out numbers and booleans, and falls back for the rest", () => {
    expect(asText("hi")).toBe("hi");
    expect(asText("")).toBe("");
    expect(asText(5)).toBe("5");
    expect(asText(false)).toBe("false");
    expect(asText(undefined)).toBe("");
    expect(asText(null, "a card")).toBe("a card");
    expect(asText({ a: 1 }, "x")).toBe("x");
  });
});

describe("clip", () => {
  it("leaves short text alone and ends cut text in an ellipsis at exactly max", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("exactly10!", 10)).toBe("exactly10!");
    expect(clip("eleven chars", 10)).toBe("eleven ch…");
  });
});

describe("firstLine", () => {
  it("takes the first non-blank line, trimmed", () => {
    expect(firstLine("\n  \n  hello there  \nsecond")).toBe("hello there");
    expect(firstLine("   \n")).toBe("");
  });

  it("clips to 140 by default, or to the max given", () => {
    expect(firstLine("x".repeat(200))).toHaveLength(140);
    expect(firstLine("abcdef", 4)).toBe("abc…");
  });
});

describe("summarizeInput", () => {
  it("picks the most telling argument, in a fixed order", () => {
    expect(summarizeInput({ path: "/a", command: "ls" })).toBe("ls");
    expect(summarizeInput({ command: "", file_path: "/b" })).toBe("/b");
  });

  it("falls back to the arguments as JSON, or nothing for none", () => {
    expect(summarizeInput({ count: 3 })).toBe('{"count":3}');
    expect(summarizeInput({})).toBe("");
    expect(summarizeInput({ command: "y".repeat(150) })).toHaveLength(100);
  });
});

describe("stageStep", () => {
  it("numbers the BOARD STATUS stages from 1", () => {
    expect(stageStep("Planning")).toBe(1);
    expect(stageStep("first shot")).toBe(3);
    expect(stageStep("Done")).toBe(STAGES.length);
  });
  it("is 0 for a missing or unknown stage", () => {
    expect(stageStep(undefined)).toBe(0);
    expect(stageStep("Vibing")).toBe(0);
  });
});

describe("projectHue", () => {
  it("gives the same name the same hue, inside 0-359", () => {
    expect(projectHue("weft")).toBe(projectHue("weft"));
    for (const name of ["weft", "blastcp", "aimhuge", ""]) {
      expect(projectHue(name)).toBeGreaterThanOrEqual(0);
      expect(projectHue(name)).toBeLessThan(360);
    }
  });

  it("tells different projects apart", () => {
    expect(projectHue("weft")).not.toBe(projectHue("blastcp"));
  });
});

describe("toolAction for every built-in tool", () => {
  it.each([
    ["BashOutput", "command"],
    ["KillShell", "command"],
    ["Read", "read"],
    ["Edit", "edit"],
    ["NotebookEdit", "edit"],
    ["Write", "write"],
    ["Grep", "search"],
    ["LS", "search"],
    ["WebSearch", "web"],
    ["WebFetch", "fetch"],
    ["Task", "agent"],
    ["TodoWrite", "plan"],
    ["TaskCreate", "plan"],
    ["TaskUpdate", "plan"],
    ["AskUserQuestion", "question"],
    ["Skill", "skill"],
    ["ToolSearch", "tools"],
    ["SendMessage", "message"],
  ])("%s is %s", (name, action) => {
    expect(toolAction(name)).toBe(action);
  });

  it("reads resize and the remaining browser verbs from the action input", () => {
    expect(toolAction("mcp__computer__computer", { action: "resize_window" })).toBe("resize");
    expect(toolAction("mcp__playwright__browser_navigate")).toBe("open");
    expect(toolAction("mcp__puppeteer__x", { action: "form_input" })).toBe("type");
    expect(toolAction("mcp__chrome__get_page_text")).toBe("look");
    // A non-string action falls back to the tool name.
    expect(toolAction("mcp__browser__click", { action: 3 })).toBe("click");
  });
});

describe("describeToolRun phrases", () => {
  const one = (action: string, times = 1) => describeToolRun(Array.from({ length: times }, () => ({ action }))).text;

  it.each([
    ["search", "Searched the code", "Searched 2 times"],
    ["web", "Searched the web", "Searched the web 2 times"],
    ["fetch", "Fetched a page", "Fetched 2 pages"],
    ["agent", "Ran an agent", "Ran 2 agents"],
    ["plan", "Updated the plan", "Updated the plan"],
    ["question", "Asked you", "Asked you"],
    ["skill", "Loaded a skill", "Loaded 2 skills"],
    ["tools", "Loaded tools", "Loaded tools"],
    ["message", "Sent a message", "Sent 2 messages"],
    ["open", "Opened a page", "Opened 2 pages"],
    ["screenshot", "Took a screenshot", "Took 2 screenshots"],
    ["click", "Clicked", "Clicked 2 times"],
    ["type", "Typed", "Typed 2 times"],
    ["key", "Pressed a key", "Pressed 2 keys"],
    ["scroll", "Scrolled", "Scrolled 2 times"],
    ["resize", "Resized the browser", "Resized the browser"],
    ["look", "Read the page", "Read the page 2 times"],
    ["browser", "Used the browser", "Used the browser 2 times"],
    ["write", "Wrote a file", "Wrote 2 files"],
  ])("%s reads %s, then %s", (action, once, twice) => {
    expect(one(action)).toBe(once);
    expect(one(action, 2)).toBe(twice);
  });

  it("names an mcp kind with no tool part after its raw server", () => {
    expect(one("mcp:0123abcd-9")).toBe("Used 0123abcd-9");
  });
});

describe("cacheMinutesLeft", () => {
  const cache = { at: 0, ttl: 3600, hit: 90, tokens: 1000 };
  it("counts whole minutes left, rounded up, and 0 once cold", () => {
    expect(cacheMinutesLeft(cache, 0)).toBe(60);
    expect(cacheMinutesLeft(cache, 59 * 60_000 + 1)).toBe(1);
    expect(cacheMinutesLeft(cache, 3600_000)).toBe(0);
    expect(cacheMinutesLeft(cache, 5_000_000)).toBe(0);
  });
});
