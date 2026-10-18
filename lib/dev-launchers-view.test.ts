import { describe, expect, it } from "vitest";
import {
  clock,
  filterLaunchers,
  launchedWord,
  launcherRow,
  pickCommand,
} from "./dev-launchers-view";
import type { DevLauncher, LauncherCommand, ServiceState } from "./types";

const cmd = (over: Partial<LauncherCommand> = {}): LauncherCommand => ({ command: "npm run dev", label: "dev", ...over });
const launcher = (cwd: string, commands: LauncherCommand[]): DevLauncher => ({ cwd, commands });

describe("filterLaunchers", () => {
  it("returns every launcher when no project is picked", () => {
    const list = [launcher("/a", [cmd()]), launcher("/b", [cmd()])];
    expect(filterLaunchers(list, null)).toEqual(list);
  });

  it("keeps a launcher whose folder is the picked project or sits inside it", () => {
    const list = [launcher("/proj", [cmd()]), launcher("/proj/web", [cmd()]), launcher("/proj-old", [cmd()])];
    expect(filterLaunchers(list, "/proj").map((l) => l.cwd)).toEqual(["/proj", "/proj/web"]);
  });
});

describe("pickCommand", () => {
  it("returns the picked command when it exists", () => {
    const l = launcher("/p", [cmd({ command: "npm run dev" }), cmd({ command: "npm run start" })]);
    expect(pickCommand(l, "npm run start").command).toBe("npm run start");
  });

  it("falls back to the first live command when nothing is picked", () => {
    const l = launcher("/p", [cmd({ command: "npm run dev" }), cmd({ command: "npm run start", run: { id: "dev:a", state: "running", startedAt: 0, restarts: 0 } })]);
    expect(pickCommand(l).command).toBe("npm run start");
  });

  it("returns the first command when nothing's live and nothing's picked", () => {
    const l = launcher("/p", [cmd({ command: "npm run dev" }), cmd({ command: "npm run start" })]);
    expect(pickCommand(l).command).toBe("npm run dev");
  });
});

describe("clock", () => {
  it("formats HH:MM in the Mac's locale", () => {
    // An ISO string with a known time; the exact format is locale-dependent but always HH:MM.
    const text = clock(new Date("2026-10-17T09:41:00").getTime());
    expect(text).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("launcherRow", () => {
  const at = (h: number, m: number) => new Date(2026, 9, 17, h, m).getTime();

  const stateRow = (state: ServiceState) => {
    const row = launcherRow("/proj", cmd({ run: { id: "dev:folder:/proj", state, startedAt: at(11, 30), restarts: 0 } }));
    return { state, live: row.live, action: row.action, status: row.status };
  };

  it("marks a running run as live with a Restart action", () => {
    expect(stateRow("running")).toEqual({ state: "running", live: true, action: "Restart", status: "Started 11:30 · running" });
  });

  it("marks a starting run as live", () => {
    expect(stateRow("starting")).toEqual({ state: "starting", live: true, action: "Restart", status: "Started 11:30 · starting" });
  });

  it("marks a failed run with a Failed copy", () => {
    const row = launcherRow("/proj", cmd({ run: { id: "dev:folder:/proj", state: "failed", startedAt: at(11, 30), restarts: 0 } }));
    expect(row.state).toBe("failed");
    expect(row.live).toBe(false);
    expect(row.action).toBe("Start");
    expect(row.status).toBe("Failed after starting 11:30");
  });

  it("marks a stopped run with a Stopped copy and no duration prefix", () => {
    const row = launcherRow("/proj", cmd({ run: { id: "dev:folder:/proj", state: "stopped", startedAt: at(11, 30), restarts: 0 } }));
    expect(row.status).toBe("Stopped · last started 11:30");
    expect(row.live).toBe(false);
  });

  it("says Restarted once after one restart", () => {
    const row = launcherRow("/proj", cmd({ run: { id: "dev:folder:/proj", state: "running", startedAt: at(11, 30), restarts: 1 } }));
    expect(row.status).toBe("Restarted 11:30 · running");
  });

  it("adds a 2× count after two or more restarts", () => {
    const row = launcherRow("/proj", cmd({ run: { id: "dev:folder:/proj", state: "running", startedAt: at(11, 30), restarts: 2 } }));
    expect(row.status).toBe("Restarted 11:30 · 2× · running");
  });

  it("has no run yet — reads the command as stopped, Start, no status", () => {
    const row = launcherRow("/proj", cmd());
    expect(row.state).toBe("stopped");
    expect(row.live).toBe(false);
    expect(row.action).toBe("Start");
    expect(row.status).toBeUndefined();
  });

  it("says something else already answers on its url", () => {
    const row = launcherRow("/proj", cmd({ url: "http://localhost:3000", answering: true }));
    expect(row.status).toBe("Something else already answers on localhost:3000");
  });

  it("leaves status undefined when there's no run and not answering", () => {
    const row = launcherRow("/proj", cmd({ url: "http://localhost:3000" }));
    expect(row.status).toBeUndefined();
  });

  it("includes the url on the row when the command has one", () => {
    const row = launcherRow("/proj", cmd({ url: "http://localhost:3000" }));
    expect(row.url).toBe("http://localhost:3000");
  });

  it("offers Stop on a live run, with the run's id, and not on a stopped one", () => {
    const live = launcherRow("/proj", cmd({ run: { id: "dev:folder:/proj", state: "running", startedAt: at(11, 30), restarts: 0 } }));
    expect(live).toMatchObject({ canStop: true, runId: "dev:folder:/proj" });
    const ended = launcherRow("/proj", cmd({ run: { id: "dev:folder:/proj", state: "stopped", startedAt: at(11, 30), restarts: 0 } }));
    expect(ended.canStop).toBe(false);
    expect(launcherRow("/proj", cmd()).canStop).toBe(false);
  });

  it("names the card that started the run, or 'its thread' when it has no title", () => {
    const run = { id: "dev:c1", state: "running" as const, startedAt: at(11, 30), restarts: 0 };
    expect(launcherRow("/proj", cmd({ run: { ...run, cardId: "c1", title: "Fix login" } })).owner).toEqual({ cardId: "c1", title: "Fix login" });
    expect(launcherRow("/proj", cmd({ run: { ...run, cardId: "c1" } })).owner).toEqual({ cardId: "c1", title: "its thread" });
    expect(launcherRow("/proj", cmd({ run })).owner).toBeUndefined();
  });

  it("reads Weft's own folder as running, with no action or Stop, and the board's own url", () => {
    const row = launcherRow("/weft", cmd({ url: "http://localhost:3000", run: { id: "dev:x", state: "stopped", startedAt: 0, restarts: 0 } }), true, "http://127.0.0.1:1024");
    expect(row).toMatchObject({ state: "running", live: true, canStop: false, self: true, url: "http://127.0.0.1:1024", status: "Weft itself: this board runs from here" });
    expect(row.action).toBeUndefined();
    expect(row.runId).toBeUndefined();
    expect(launcherRow("/weft", cmd({ url: "http://localhost:3000" }), true).url).toBeUndefined();
  });

  it("composes the key from cwd and command", () => {
    const row = launcherRow("/proj", cmd({ command: "npm run dev" }));
    expect(row.key).toBe("/proj\nnpm run dev");
    expect(row.folder).toBe("proj");
    expect(row.label).toBe("dev");
  });
});

describe("launchedWord", () => {
  it("reads the right word for each result", () => {
    expect(launchedWord("started")).toBe("Started");
    expect(launchedWord("restarted")).toBe("Restarted");
  });
});
