import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// import.ts reads Claude Code's config folder at load time, so point it at a temp one first.
const config = fs.mkdtempSync(path.join(os.tmpdir(), "weft-import-"));
process.env.CLAUDE_CONFIG_DIR = config;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ getSessionMessages: vi.fn(), listSessions: vi.fn() }));
vi.mock("./store", () => ({ addCards: vi.fn(), getThread: vi.fn(), listCards: vi.fn(() => []), replaceThread: vi.fn(), updateCard: vi.fn() }));
vi.mock("./transcript", () => ({ transcriptToThread: vi.fn() }));
vi.mock("./settings", () => ({ dismissedSessions: vi.fn(() => []) }));

const { lastPermissionMode, sessionMode } = await import("./import");

const line = (record: Record<string, unknown>) => JSON.stringify(record);

function sessionFile(lines: string[]) {
  const file = path.join(config, `${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

beforeEach(() => {
  fs.rmSync(path.join(config, "settings.json"), { force: true });
});

describe("lastPermissionMode", () => {
  it("takes the last mode recorded, user messages and permission-mode records alike", () => {
    const text = [
      line({ type: "permission-mode", permissionMode: "bypassPermissions" }),
      line({ type: "user", permissionMode: "auto", message: { content: "hi" } }),
      line({ type: "assistant", message: { content: [] } }),
    ].join("\n");
    expect(lastPermissionMode(text)).toBe("auto");
  });

  it("maps plan to default and skips modes it doesn't know", () => {
    expect(lastPermissionMode(line({ permissionMode: "plan" }))).toBe("default");
    expect(lastPermissionMode([line({ permissionMode: "acceptEdits" }), line({ permissionMode: "someday" })].join("\n"))).toBe("acceptEdits");
    expect(lastPermissionMode(line({ type: "user" }))).toBeUndefined();
  });
});

describe("sessionMode", () => {
  it("prefers the mode from the file's tail", () => {
    expect(sessionMode(undefined, "auto")).toBe("auto");
  });

  it("reads the file when the tail had none", () => {
    const file = sessionFile([line({ type: "user", permissionMode: "auto" }), line({ type: "assistant" })]);
    expect(sessionMode(file)).toBe("auto");
  });

  it("falls back to the user's default mode, then to default", () => {
    const file = sessionFile([line({ type: "user" })]);
    expect(sessionMode(file)).toBe("default");
    fs.writeFileSync(path.join(config, "settings.json"), JSON.stringify({ permissions: { defaultMode: "acceptEdits" } }));
    expect(sessionMode(file)).toBe("acceptEdits");
    expect(sessionMode(undefined)).toBe("acceptEdits");
  });
});

// Picking up sessions: the sync, live detection, and transcripts. ps is faked; session files are
// real .jsonl files under the temp config folder's projects/.
import { randomUUID } from "node:crypto";
import { afterEach } from "vitest";
import type { Card } from "./types";

vi.mock("node:child_process", () => ({ execFile: vi.fn(), execFileSync: vi.fn() }));

const { execFile, execFileSync } = await import("node:child_process");
const sdk = await import("@anthropic-ai/claude-agent-sdk");
const store = await import("./store");
const { dismissedSessions } = await import("./settings");
const { transcriptToThread } = await import("./transcript");
const { isOpenElsewhere, loadTranscript, parseTitle, releaseSession, sessionFiles, startSessionSync, syncSessions } = await import("./import");

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const projectDir = path.join(config, "projects", "-Users-me-app");
const runningDir = path.join(config, "sessions");
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const said = (text: unknown, at: string, extra: Record<string, unknown> = {}) =>
  line({ type: "user", timestamp: at, message: { role: "user", content: text }, ...extra });
const answered = (content: unknown, at: string, stop_reason: string | null = "end_turn", extra: Record<string, unknown> = {}) =>
  line({ type: "assistant", timestamp: at, message: { role: "assistant", stop_reason, content: typeof content === "string" ? [{ type: "text", text: content }] : content }, ...extra });

// A session file in the projects folder; returns its session id.
function onDisk(lines: string[], id: string = randomUUID()) {
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, `${id}.jsonl`), lines.join("\n") + "\n");
  return id;
}

// What listSessions reports for a session.
const info = (sessionId: string, over: Record<string, unknown> = {}) => ({
  sessionId,
  cwd: "/Users/me/app",
  summary: "",
  lastModified: Date.now() - 20 * DAY,
  createdAt: Date.now() - 20 * DAY,
  ...over,
});

const boardCard = (sessionId: string, over: Partial<Card> = {}): Card => ({
  id: randomUUID(),
  title: "Old title",
  prompt: "",
  cwd: "/Users/me/app",
  backend: "claude",
  permissionMode: "default",
  column: "review",
  sessionId,
  source: "claude-code",
  lastActivity: Date.now() - 20 * DAY,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

let board: Card[] = [];

async function sync(sessions: ReturnType<typeof info>[], cards: Card[] = []) {
  board = cards;
  vi.mocked(sdk.listSessions).mockResolvedValue(sessions as never);
  return syncSessions();
}

const addedCards = () => vi.mocked(store.addCards).mock.calls.flatMap((c) => c[0]);
const addedFor = (sessionId: string) => addedCards().find((c) => c.sessionId === sessionId);
const patchFor = (card: Card) =>
  vi.mocked(store.updateCard).mock.calls.filter(([id]) => id === card.id).reduce<Partial<Card>>((all, [, patch]) => ({ ...all, ...patch }), {});

// What /bin/ps prints: "pid ppid command" per line.
function ps(out = "") {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    (args[3] as (err: Error | null, stdout: string) => void)(null, out);
  }) as never);
  vi.mocked(execFileSync).mockReturnValue(out as never);
}

function runningEntry(name: string, entry: unknown) {
  fs.mkdirSync(runningDir, { recursive: true });
  fs.writeFileSync(path.join(runningDir, name), typeof entry === "string" ? entry : JSON.stringify(entry));
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function resetPickup() {
  vi.clearAllMocks();
  board = [];
  vi.mocked(store.listCards).mockImplementation(() => board);
  vi.mocked(dismissedSessions).mockReturnValue([]);
  fs.rmSync(path.join(config, "projects"), { recursive: true, force: true });
  fs.rmSync(runningDir, { recursive: true, force: true });
  ps();
}

describe("parseTitle", () => {
  it("splits a status word off the session's title", () => {
    expect(parseTitle("GOING DEEPER - Weft desktop app")).toEqual({ title: "Weft desktop app", stage: "Going deeper" });
    expect(parseTitle("  PRE-BUILD REFACTORING — split the board  ")).toEqual({ title: "split the board", stage: "Pre-build refactoring" });
    expect(parseTitle("DONE – shipped")).toEqual({ title: "shipped", stage: "Done" });
  });

  it("keeps a title whole when it doesn't start with a known status word", () => {
    expect(parseTitle("API - rate limits")).toEqual({ title: "API - rate limits" });
    expect(parseTitle("Planning - lowercase")).toEqual({ title: "Planning - lowercase" });
    expect(parseTitle(" fix the build ")).toEqual({ title: "fix the build" });
  });
});

describe("sessionFiles", () => {
  beforeEach(resetPickup);

  it("is empty when there's no projects folder", () => {
    expect(sessionFiles().size).toBe(0);
  });

  it("maps each session id to its .jsonl file across project folders", () => {
    const a = onDisk([said("hi", ago(MIN))]);
    const other = path.join(config, "projects", "-Users-me-other");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "b-session.jsonl"), "");
    fs.writeFileSync(path.join(other, "notes.txt"), "");
    fs.writeFileSync(path.join(config, "projects", "stray-file.jsonl"), "");
    expect(sessionFiles()).toEqual(
      new Map([
        [a, path.join(projectDir, `${a}.jsonl`)],
        ["b-session", path.join(other, "b-session.jsonl")],
      ]),
    );
  });
});

describe("syncSessions: new sessions", () => {
  beforeEach(resetPickup);

  it("adds a card per session, titled and placed from its title and last activity", async () => {
    const deeper = onDisk([said("build it", ago(10 * DAY)), answered("Built.", ago(10 * DAY))]);
    const done = onDisk([said("ship it", ago(MIN)), answered("Shipped.", ago(MIN))]);
    const oldAt = ago(10 * DAY);
    const old = onDisk([said("Fix the login bug\nplease", ago(11 * DAY)), answered("Fixed.", oldAt)]);
    const recent = onDisk([said("rename things", ago(MIN)), answered("Renamed.", ago(MIN))]);
    const result = await sync([
      info(deeper, { customTitle: "GOING DEEPER - Weft desktop app", firstPrompt: "build it" }),
      info(done, { customTitle: "DONE - release", summary: "ignored" }),
      info(old, { firstPrompt: "Fix the login bug\nplease" }),
      info(recent, { summary: "Rename things" }),
    ]);
    expect(result).toEqual({ sessions: 4, added: 4, updated: 0 });
    expect(store.addCards).toHaveBeenCalledTimes(1);
    expect(addedFor(deeper)).toMatchObject({ title: "Weft desktop app", stage: "Going deeper", column: "review", prompt: "build it", lastLine: "build it" });
    expect(addedFor(done)).toMatchObject({ title: "release", stage: "Done", column: "done" });
    expect(addedFor(old)).toMatchObject({ title: "Fix the login bug\nplease", column: "done", lastLine: "Fix the login bug" });
    expect(addedFor(recent)).toMatchObject({ title: "Rename things", column: "review", prompt: "" });
    expect(addedFor(recent)?.lastLine).toBeUndefined();
    const card = addedFor(old)!;
    expect(card).toMatchObject({ backend: "claude", source: "claude-code", cwd: "/Users/me/app", openElsewhere: false, permissionMode: "default" });
    expect(card.lastActivity).toBe(Date.parse(oldAt));
    expect(card.updatedAt).toBe(card.lastActivity);
  });

  it("falls back to the session's own times and the home folder without a session file", async () => {
    const id = randomUUID();
    const createdAt = Date.now() - 5 * MIN;
    await sync([info(id, { cwd: undefined, createdAt, lastModified: createdAt + 1 }), info(randomUUID(), { createdAt: undefined, lastModified: 123 })]);
    expect(addedFor(id)).toMatchObject({ title: "Untitled thread", cwd: os.homedir(), lastActivity: createdAt, createdAt, column: "review" });
    const [, second] = addedCards();
    expect(second).toMatchObject({ lastActivity: 123, createdAt: 123, column: "done" });
  });

  it("uses the session's own times when its file can't be read or has no timestamps", async () => {
    const createdAt = Date.now() - 4 * DAY;
    const noStamps = onDisk([line({ type: "summary", summary: "x" })]);
    const unreadable = randomUUID();
    fs.mkdirSync(path.join(projectDir, `${unreadable}.jsonl`), { recursive: true });
    await sync([info(noStamps, { createdAt }), info(unreadable, { createdAt })]);
    expect(addedFor(noStamps)?.lastActivity).toBe(createdAt);
    expect(addedFor(unreadable)?.lastActivity).toBe(createdAt);
  });

  it("continues a session in the mode it last ran in", async () => {
    const fromTail = onDisk([said("go", ago(MIN), { permissionMode: "bypassPermissions" }), answered("ok", ago(MIN))]);
    // A long session: the mode is only at the start, beyond the 256 KB tail.
    const fromStart = onDisk([
      said("go", ago(DAY), { permissionMode: "acceptEdits" }),
      answered("x".repeat(300 * 1024), ago(DAY)),
      answered("done", ago(DAY)),
    ]);
    await sync([info(fromTail), info(fromStart)]);
    expect(addedFor(fromTail)?.permissionMode).toBe("bypassPermissions");
    expect(addedFor(fromStart)?.permissionMode).toBe("acceptEdits");
  });

  it("skips dismissed sessions and tooling runs in temp folders", async () => {
    const dismissed = randomUUID();
    vi.mocked(dismissedSessions).mockReturnValue([dismissed]);
    const result = await sync([
      info(dismissed),
      info(randomUUID(), { cwd: path.join(os.tmpdir(), "vitest-run") }),
      info(randomUUID(), { cwd: "/private/var/folders/xy/T/agent" }),
    ]);
    expect(result).toEqual({ sessions: 3, added: 0, updated: 0 });
    expect(store.addCards).not.toHaveBeenCalled();
  });

  it("puts a session with a turn running right now in Running", async () => {
    const id = onDisk([answered("Done before.", ago(3 * MIN)), said("now do this", ago(30_000))]);
    await sync([info(id, { firstPrompt: "first" })]);
    expect(addedFor(id)).toMatchObject({ column: "running", lastLine: "Working in another app" });
  });

  it.each([
    ["a tool call", (at: string) => answered([{ type: "tool_use", id: "t", name: "Bash", input: {} }], at, "tool_use"), "running"],
    ["a reply still streaming", (at: string) => answered("partial", at, null), "running"],
    ["a tool result", (at: string) => said([{ type: "tool_result", tool_use_id: "t", content: "ok" }], at), "running"],
    ["a prompt in text blocks", (at: string) => said([{ type: "text", text: "go on" }], at), "running"],
    ["an interrupt", (at: string) => said("[Request interrupted by user]", at), "review"],
    ["a local command", (at: string) => said([{ type: "text", text: "<local-command-stdout>ok</local-command-stdout>" }], at), "review"],
    ["a user record with no content", (at: string) => line({ type: "user", timestamp: at }), "running"],
  ])("reads the turn as in progress or not when the session ends with %s", async (_name, last, column) => {
    const id = onDisk([said("start", ago(MIN)), answered("Sure.", ago(MIN)), last(ago(20_000))]);
    await sync([info(id)]);
    expect(addedFor(id)?.column).toBe(column);
  });

  it("looks past meta, sidechain, and unreadable records for the turn's last real message", async () => {
    const id = onDisk([
      said("start", ago(MIN)),
      answered("All done.", ago(MIN)),
      said("caveat", ago(30_000), { isMeta: true }),
      said("subagent prompt", ago(30_000), { isSidechain: true }),
      line({ type: "progress", timestamp: ago(20_000), data: { type: "user" }, note: '"type":"user"' }),
      '{"type":"user", truncated',
    ]);
    await sync([info(id)]);
    expect(addedFor(id)?.column).toBe("review");
  });

  it("doesn't count an unfinished turn from long ago as running, unless the session is open", async () => {
    const quiet = onDisk([said("go", ago(10 * MIN))]);
    const open = onDisk([said("go", ago(10 * MIN))]);
    ps(`  4242 1 claude --resume ${open}\n  4243 ${process.pid} claude --resume ${quiet}\nnot a ps line`);
    await sync([info(quiet), info(open)]);
    expect(addedFor(quiet)).toMatchObject({ column: "review", openElsewhere: false });
    expect(addedFor(open)).toMatchObject({ column: "running", openElsewhere: true });
  });

  it("trusts Claude Code's own report of a session's status", async () => {
    const waiting = onDisk([said("go", ago(10 * MIN)), answered("Which one?", ago(10 * MIN))]);
    const busy = onDisk([said("go", ago(10 * DAY)), answered("ok", ago(10 * DAY))]);
    const idle = onDisk([said("go", ago(20_000))]);
    ps(`101 1 /Applications/Claude.app/claude\n102 1 claude\n103 1 claude`);
    runningEntry("101.json", { pid: 101, sessionId: waiting, status: "waiting" });
    runningEntry("102.json", { pid: 102, sessionId: busy, status: "busy" });
    runningEntry("103.json", { pid: 103, sessionId: idle, status: "idle" });
    await sync([info(waiting), info(busy), info(idle)]);
    expect(addedFor(waiting)).toMatchObject({ column: "needs_you", lastLine: "Waiting for you in another app", openElsewhere: true });
    expect(addedFor(busy)).toMatchObject({ column: "running", lastLine: "Working in another app" });
    expect(addedFor(idle)).toMatchObject({ column: "review", openElsewhere: true });
  });

  it("ignores running-session entries that are stale, Weft's own, or malformed", async () => {
    const stale = onDisk([said("go", ago(10 * DAY)), answered("ok", ago(10 * DAY))]);
    const own = onDisk([said("go", ago(10 * DAY)), answered("ok", ago(10 * DAY))]);
    const odd = onDisk([said("go", ago(10 * DAY)), answered("ok", ago(10 * DAY))]);
    ps(`201 ${process.pid} claude\n202 1 claude`);
    runningEntry("200.json", { pid: 200, sessionId: stale, status: "busy" });
    runningEntry("201.json", { pid: 201, sessionId: own, status: "busy" });
    runningEntry("202.json", { pid: 202, sessionId: odd, status: "thinking" });
    runningEntry("203.json", { pid: "203", sessionId: odd });
    runningEntry("204.json", "{ not json");
    runningEntry("notes.txt", "x");
    await sync([info(stale), info(own), info(odd)]);
    expect(addedFor(stale)).toMatchObject({ column: "done", openElsewhere: false });
    expect(addedFor(own)).toMatchObject({ column: "done", openElsewhere: false });
    expect(addedFor(odd)).toMatchObject({ column: "done", openElsewhere: true });
  });

  it("treats every session as closed when ps fails", async () => {
    const id = onDisk([said("go", ago(10 * MIN))]);
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => (args[3] as (err: Error) => void)(new Error("no ps"))) as never);
    await sync([info(id)]);
    expect(addedFor(id)).toMatchObject({ column: "review", openElsewhere: false });
  });

  it("shares one sync between callers while it runs", async () => {
    vi.mocked(sdk.listSessions).mockResolvedValue([]);
    const a = syncSessions();
    expect(syncSessions()).toBe(a);
    await a;
    expect(sdk.listSessions).toHaveBeenCalledTimes(1);
    const b = syncSessions();
    expect(b).not.toBe(a);
    await b;
  });
});

describe("syncSessions: cards already on the board", () => {
  beforeEach(resetPickup);

  it("follows new messages from outside Weft: title, stage, activity, column, and the last reply", async () => {
    const last = ago(DAY);
    const id = onDisk([
      said("go", ago(2 * DAY)),
      answered("Earlier reply", ago(2 * DAY)),
      answered("subagent text", ago(2 * DAY), "end_turn", { isSidechain: true }),
      answered([{ type: "tool_use", id: "t", name: "Bash", input: {} }], ago(2 * DAY), "tool_use"),
      said([{ type: "tool_result", tool_use_id: "t", content: "ok" }], ago(2 * DAY)),
      answered("\n\nAll green now.\nMore detail.\nBOARD STATUS: column=review | stage=Polishing", ago(DAY)),
      answered([{ type: "thinking", thinking: "hmm" }], last),
    ]);
    const card = boardCard(id, { column: "done" });
    const result = await sync([info(id, { customTitle: "POLISHING - New title" })], [card]);
    expect(result).toEqual({ sessions: 1, added: 0, updated: 1 });
    expect(patchFor(card)).toEqual({ column: "review", lastLine: "All green now.", title: "New title", stage: "Polishing", lastActivity: Date.parse(last) });
  });

  it("keeps a title you or Weft's retitle chose, while the stage still follows Claude Code", async () => {
    const id = onDisk([said("go", ago(2 * DAY)), answered("Done.", ago(DAY))]);
    const card = boardCard(id, { title: "🐞 Compile Error", titleBy: "auto", column: "done" });
    await sync([info(id, { customTitle: "POLISHING - Image attachment" })], [card]);
    expect(patchFor(card)).not.toHaveProperty("title");
    expect(patchFor(card)).toMatchObject({ stage: "Polishing" });

    const quiet = boardCard(id, { title: "Mine", titleBy: "user", lastActivity: Date.now() });
    await sync([info(id, { customTitle: "Something else" })], [quiet]);
    expect(patchFor(quiet)).not.toHaveProperty("title");
  });

  it("takes the reply from an earlier message when the last ones have no text", async () => {
    const id = onDisk([
      said("go", ago(DAY)),
      answered("The real answer", ago(DAY)),
      answered("from a subagent", ago(DAY), "end_turn", { isSidechain: true }),
      answered([{ type: "tool_use", id: "t", name: "Read", input: {} }], ago(DAY), "end_turn"),
      answered("BOARD STATUS: column=review", ago(DAY)),
      '{"type":"assistant", broken',
    ]);
    const card = boardCard(id, { title: "t", lastLine: "old" });
    await sync([info(id, { summary: "t" })], [card]);
    expect(patchFor(card).lastLine).toBe("The real answer");
  });

  it("only renames a card when nothing new happened", async () => {
    const stamp = ago(DAY);
    const id = onDisk([said("go", stamp), answered("ok", stamp)]);
    const at = Date.parse(stamp);
    const card = boardCard(id, { lastActivity: at, column: "backlog" });
    await sync([info(id, { customTitle: "CLEANING UP - Renamed" })], [card]);
    expect(patchFor(card)).toEqual({ title: "Renamed", stage: "Cleaning up" });
  });

  it("leaves a card alone when nothing changed", async () => {
    const stamp = ago(DAY);
    const id = onDisk([said("go", stamp), answered("ok", stamp)]);
    const at = Date.parse(stamp);
    const card = boardCard(id, { title: "Same", lastActivity: at, column: "backlog" });
    expect(await sync([info(id, { customTitle: "Same" })], [card])).toEqual({ sessions: 1, added: 0, updated: 0 });
    expect(store.updateCard).not.toHaveBeenCalled();
  });

  it("doesn't move or rename a card Weft has open, but notes the session opening elsewhere", async () => {
    const id = onDisk([said("go", ago(20_000))]);
    ps(`300 1 claude --session-id=${id}`);
    const warm = boardCard(id, { warm: true, column: "backlog" });
    await sync([info(id, { customTitle: "Different" })], [warm]);
    expect(patchFor(warm)).toEqual({ openElsewhere: true });
  });

  it("doesn't move a card waiting on a permission answer, but still renames it", async () => {
    const id = onDisk([said("go", ago(20_000))]);
    const card = boardCard(id, { column: "needs_you", pending: { id: "p" } as Card["pending"] });
    await sync([info(id, { customTitle: "Renamed" })], [card]);
    expect(patchFor(card)).toEqual({ title: "Renamed", stage: undefined, lastActivity: expect.any(Number) });
  });

  it("leaves Weft's own cards and cards that continued a session as a copy alone", async () => {
    const own = onDisk([said("go", ago(MIN))]);
    const forked = onDisk([said("go", ago(MIN))]);
    const mine = boardCard(own, { source: undefined });
    const copy = boardCard(randomUUID(), { forkedFrom: forked });
    expect(await sync([info(own), info(forked)], [mine, copy])).toEqual({ sessions: 2, added: 0, updated: 0 });
    expect(store.updateCard).not.toHaveBeenCalled();
    expect(store.addCards).not.toHaveBeenCalled();
  });

  it("moves a card to Running while its session is live elsewhere, and back when it goes quiet", async () => {
    const id = onDisk([answered("ok", ago(DAY)), said("go", ago(20_000))]);
    const card = boardCard(id, { column: "review", lastActivity: Date.now() });
    await sync([info(id)], [card]);
    expect(patchFor(card)).toMatchObject({ column: "running", lastLine: "Working in another app" });

    Object.assign(card, patchFor(card));
    vi.mocked(store.updateCard).mockClear();
    fs.appendFileSync(path.join(projectDir, `${id}.jsonl`), answered("Finished it.", ago(10_000)) + "\n");
    fs.utimesSync(path.join(projectDir, `${id}.jsonl`), new Date(), new Date(Date.now() + 5000));
    card.lastActivity = Date.now();
    await sync([info(id)], [card]);
    expect(patchFor(card)).toEqual({ column: "review", lastLine: "Finished it." });
  });
});

describe("isOpenElsewhere", () => {
  beforeEach(resetPickup);

  it("finds a session resumed in a terminal, or listed as running by Claude Code", () => {
    const resumed = randomUUID();
    const fresh = randomUUID();
    ps(`  500 1 claude --resume ${resumed}\n  501 1 claude`);
    runningEntry("501.json", { pid: 501, sessionId: fresh });
    expect(isOpenElsewhere(resumed)).toBe(true);
    expect(isOpenElsewhere(fresh)).toBe(true);
    expect(isOpenElsewhere(randomUUID())).toBe(false);
  });

  it("doesn't count Weft's own CLIs", () => {
    const id = randomUUID();
    ps(`600 ${process.pid} claude --resume ${id}`);
    expect(isOpenElsewhere(id)).toBe(false);
  });

  it("is false when ps fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("no ps");
    });
    expect(isOpenElsewhere(randomUUID())).toBe(false);
  });
});

describe("releaseSession", () => {
  beforeEach(resetPickup);

  it("stops the CLIs outside Weft holding the session and counts them", () => {
    const id = randomUUID();
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 703) throw new Error("ESRCH");
      return true;
    });
    ps(
      [
        `700 1 claude --resume ${id}`,
        `701 1 claude --session-id ${id}`,
        `702 ${process.pid} claude --resume ${id}`,
        `703 1 claude --resume ${id}`,
        `704 1 claude --resume ${randomUUID()}`,
        `705 1 claude`,
        `706 ${process.pid} claude`,
        "garbage",
      ].join("\n"),
    );
    runningEntry("705.json", { pid: 705, sessionId: id });
    runningEntry("706.json", { pid: 706, sessionId: id });
    runningEntry("707.json", { pid: 707, sessionId: id });
    expect(releaseSession(id)).toBe(3);
    expect(kill.mock.calls.map(([pid]) => pid).sort()).toEqual([700, 701, 703, 705]);
    expect(kill).toHaveBeenCalledWith(700, "SIGTERM");
    kill.mockRestore();
  });

  it("stops nothing when ps fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("no ps");
    });
    expect(releaseSession(randomUUID())).toBe(0);
  });
});

describe("startSessionSync", () => {
  const g = globalThis as unknown as { __weftSyncTimer?: ReturnType<typeof setInterval>; __weftCheckTimer?: ReturnType<typeof setInterval>; __weftSync?: Promise<unknown> };

  beforeEach(() => {
    resetPickup();
    vi.mocked(sdk.listSessions).mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    clearInterval(g.__weftSyncTimer);
    clearInterval(g.__weftCheckTimer);
    g.__weftSyncTimer = undefined;
    g.__weftCheckTimer = undefined;
    vi.useRealTimers();
  });

  it("syncs now, then every minute, once per process", async () => {
    startSessionSync();
    startSessionSync();
    await flush();
    expect(sdk.listSessions).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(sdk.listSessions).toHaveBeenCalledTimes(2);
  });

  it("logs a first sync that fails, and keeps going", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sdk.listSessions).mockRejectedValue(new Error("boom"));
    startSessionSync();
    await flush();
    expect(error).toHaveBeenCalledWith("Session sync failed:", expect.objectContaining({ message: "boom" }));
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(sdk.listSessions).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("checks live sessions every few seconds between syncs", async () => {
    const live = onDisk([answered("ok", ago(DAY)), said("go", ago(10_000))]);
    const quiet = onDisk([said("go", ago(DAY)), answered("ok", ago(DAY))]);
    const warm = onDisk([said("go", ago(DAY)), answered("ok", ago(DAY))]);
    ps(`800 1 claude --resume ${quiet}`);
    const liveCard = boardCard(live, { lastActivity: 0 });
    const quietCard = boardCard(quiet, { lastActivity: Date.now() });
    const warmCard = boardCard(warm, { warm: true, lastActivity: 0, openElsewhere: false });
    const skipped = [
      boardCard(randomUUID(), { source: undefined }),
      boardCard(randomUUID(), { sessionId: undefined }),
      boardCard(live, { forkedFrom: live }),
      boardCard(randomUUID()),
    ];
    startSessionSync();
    await flush();
    board = [liveCard, quietCard, warmCard, ...skipped];
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(patchFor(liveCard)).toMatchObject({ column: "running", lastLine: "Working in another app", lastActivity: expect.any(Number) });
    expect(patchFor(quietCard)).toEqual({ openElsewhere: true });
    expect(patchFor(warmCard)).toEqual({});
    expect(vi.mocked(store.updateCard).mock.calls.map(([id]) => id).sort()).toEqual([liveCard.id, quietCard.id].sort());
  });

  it("skips a check while a full sync runs", async () => {
    startSessionSync();
    await flush();
    const id = onDisk([said("go", ago(10_000))]);
    board = [boardCard(id, { lastActivity: 0 })];
    g.__weftSync = new Promise(() => {});
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(store.updateCard).not.toHaveBeenCalled();
    g.__weftSync = undefined;
  });
});

describe("loadTranscript", () => {
  beforeEach(() => {
    resetPickup();
    vi.mocked(sdk.getSessionMessages).mockResolvedValue([{ type: "user" }] as never);
    vi.mocked(transcriptToThread).mockReturnValue([{ kind: "user", text: "hi", at: 1 }]);
    vi.mocked(store.getThread).mockReturnValue([]);
  });

  it("reads the session into the card's thread and notes when", async () => {
    const card = boardCard("s-1", { cwd: config, lastActivity: 500 });
    await loadTranscript(card);
    expect(sdk.getSessionMessages).toHaveBeenCalledWith("s-1", { dir: config });
    expect(transcriptToThread).toHaveBeenCalledWith([{ type: "user" }], { cwd: config });
    expect(store.replaceThread).toHaveBeenCalledWith(card.id, [{ kind: "user", text: "hi", at: 1 }]);
    expect(store.updateCard).toHaveBeenCalledWith(card.id, { transcriptAt: 500 });
  });

  it("searches every project for a session whose folder is gone, and uses updatedAt without activity", async () => {
    const card = boardCard("s-2", { cwd: "/no/such/folder", lastActivity: undefined, updatedAt: 77 });
    await loadTranscript(card);
    expect(sdk.getSessionMessages).toHaveBeenCalledWith("s-2", undefined);
    expect(store.updateCard).toHaveBeenCalledWith(card.id, { transcriptAt: 77 });
  });

  it("skips a transcript it already read, unless the thread is empty", async () => {
    const card = boardCard("s-3", { cwd: config, lastActivity: 500, transcriptAt: 500 });
    vi.mocked(store.getThread).mockReturnValue([{ kind: "user", text: "hi", at: 1 }]);
    await loadTranscript(card);
    expect(sdk.getSessionMessages).not.toHaveBeenCalled();
    vi.mocked(store.getThread).mockReturnValue([]);
    await loadTranscript(card);
    expect(sdk.getSessionMessages).toHaveBeenCalledTimes(1);
  });

  it("leaves Weft's own threads, cards without a session, and warm cards alone", async () => {
    await loadTranscript(boardCard("s-4", { source: undefined }));
    await loadTranscript(boardCard("s-5", { sessionId: undefined }));
    await loadTranscript(boardCard("s-6", { warm: true }));
    expect(sdk.getSessionMessages).not.toHaveBeenCalled();
    expect(store.replaceThread).not.toHaveBeenCalled();
  });
});
