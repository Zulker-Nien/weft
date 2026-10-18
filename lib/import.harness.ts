// The fake SDK, store, child_process and welcome mocks the import tests share (lib/import.test.ts,
// lib/import-welcome.test.ts). A test file makes the shared state with vi.hoisted (harnessState)
// and hands it to the mock factories the harness exports:
//   vi.mock("./store", async () => (await import("./import.harness")).storeMock(h));
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { Card } from "./types";

// A temp config folder shared by every test in the process: import.ts reads CLAUDE_CONFIG_DIR at
// load time, so each test file must set it before its `await import("./import")`. Setting it here
// keeps the test files from re-deriving a temp dir each (and from racing for distinct dirs).
export const config = fs.mkdtempSync(`/tmp/weft-import-harness-${randomUUID()}`);
process.env.CLAUDE_CONFIG_DIR = config;

export const projectDir = `${config}/projects/-Users-me-app`;
export const runningDir = `${config}/sessions`;
export const MIN = 60_000;
export const DAY = 24 * 60 * MIN;

// Each test's board (lib/import-sync.ts asks the store for it). Lives on the harness so resetPickup
// can clear it and the tests can drive it.
export function harnessState() {
  return {
    board: [] as Card[],
  };
}

export type Harness = ReturnType<typeof harnessState>;

// The shared welcome mock: tests that don't care which welcome is in play leave it at the default
// (a board that has answered the welcome, so sessions import); the welcome gate tests override it
// per-test through setWelcome. The mock lives at module scope (not inside vi.hoisted) so the test
// files can import it as a regular value.
export const welcomeMock = {
  welcomeOrAdopt: vi.fn(() => ({ at: 0, countHistory: true, fresh: false, skip: [] })),
  importsSession: vi.fn<(w: unknown, cwd: string, lastActivity: number) => boolean>(() => true),
  isScratch: vi.fn(() => false),
  welcome: vi.fn(() => ({ at: 0, countHistory: true, fresh: false, skip: [] })),
  countsAt: vi.fn(() => true),
  WELCOME_FILE: "",
};

// The mocks the test files wire into vi.mock. Each returns a fresh module-shaped object the
// vi.mock factory hands back; the inner vi.fn()s are what the test file reads back when it does
// `await import("./store")` and so on.
export const sdkMock = () => ({ getSessionMessages: vi.fn(), listSessions: vi.fn() });
export const storeMock = (h: Harness) => ({
  DATA_DIR: config,
  addCards: vi.fn(),
  getThread: vi.fn(),
  listCards: vi.fn(() => h.board),
  replaceThread: vi.fn(),
  updateCard: vi.fn(),
});
export const transcriptMock = () => ({ transcriptToThread: vi.fn() });
export const settingsMock = () => ({ dismissedSessions: vi.fn(() => []) });
export const childProcessMock = () => ({ execFile: vi.fn(), execFileSync: vi.fn() });

// All the vi.mock factories a test file needs in one go, so the test file's top is two lines
// instead of six.
export function installMocks(h: Harness) {
  return {
    childProcess: childProcessMock(),
    sdk: sdkMock(),
    store: storeMock(h),
    transcript: transcriptMock(),
    settings: settingsMock(),
    welcome: welcomeMock,
  };
}

// JSONL line helpers and a session-file writer under the temp config folder's projects/.
export const line = (record: Record<string, unknown>) => JSON.stringify(record);
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
export const said = (text: unknown, at: string, extra: Record<string, unknown> = {}) =>
  line({ type: "user", timestamp: at, message: { role: "user", content: text }, ...extra });
export const answered = (content: unknown, at: string, stop_reason: string | null = "end_turn", extra: Record<string, unknown> = {}) =>
  line({ type: "assistant", timestamp: at, message: { role: "assistant", stop_reason, content: typeof content === "string" ? [{ type: "text", text: content }] : content }, ...extra });

// A session file in the projects folder; returns its session id.
export function onDisk(lines: string[], id: string = randomUUID()) {
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(`${projectDir}/${id}.jsonl`, lines.join("\n") + "\n");
  return id;
}

// What listSessions reports for a session.
export function info(sessionId: string, over: Record<string, unknown> = {}) {
  return {
    sessionId,
    cwd: "/Users/me/app",
    summary: "",
    lastModified: Date.now() - 20 * DAY,
    createdAt: Date.now() - 20 * DAY,
    ...over,
  };
}

export function boardCard(sessionId: string, over: Partial<Card> = {}): Card {
  return {
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
  };
}

// The mockable surface of a vitest fn: just enough that we can read `.mock.calls` and call
// `.mockImplementation` / `.mockReturnValue`. The harness helpers below take objects whose
// properties are *any* function (loose, to match the real `typeof import(...)` namespace
// the test files pass in) and unwrap them with vi.mocked() to get the mock surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
type MockHolder<T> = { [K in keyof T]: T[K] extends AnyFn ? T[K] : never };

// A default mock for `ps`: returns no live sessions, and execFileSync falls through to the same.
export function psMock(childProcess: { execFile: AnyFn; execFileSync: AnyFn }, out = "") {
  vi.mocked(childProcess.execFile).mockImplementation(((...args: unknown[]) => {
    (args[3] as (err: Error | null, stdout: string) => void)(null, out);
  }) as never);
  vi.mocked(childProcess.execFileSync).mockReturnValue(out);
}

export function runningEntry(name: string, entry: unknown) {
  fs.mkdirSync(runningDir, { recursive: true });
  fs.writeFileSync(`${runningDir}/${name}`, typeof entry === "string" ? entry : JSON.stringify(entry));
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));

// The setWelcome helper the welcome gate tests use to swap in a custom welcome + per-session gate.
export function setWelcome(
  welcome: unknown,
  gate: (w: unknown, cwd: string, lastActivity: number) => boolean = () => true,
) {
  welcomeMock.welcomeOrAdopt.mockReturnValue(welcome as never);
  welcomeMock.importsSession.mockImplementation((w, cwd, lastActivity) => gate(w, cwd, lastActivity));
}

// Records the cards the sync just added (the first argument to each store.addCards call) and
// looks up the one a given session id became. The store the test file passes in is the real
// module namespace (`typeof import("./store")`); vi.mocked() reads the mocked vi.fn() out of
// the live module, so the signature is loose — any function-shaped property works.
export const addedCards = (store: MockHolder<{ addCards: AnyFn }>) =>
  vi.mocked(store.addCards).mock.calls.flatMap((c) => c[0] as Card);
export const addedFor = (store: MockHolder<{ addCards: AnyFn }>, sessionId: string) =>
  addedCards(store).find((c) => c.sessionId === sessionId);
export const patchFor = (store: MockHolder<{ updateCard: AnyFn }>, card: Card) => {
  const calls = vi.mocked(store.updateCard).mock.calls.filter(([id]) => id === card.id) as [string, Partial<Card>][];
  return calls.reduce<Partial<Card>>((all, [, patch]) => ({ ...all, ...patch }), {});
};

// Resets the shared mocks and the temp config folder. Each describe()'s beforeEach calls this.
export function resetPickup(
  h: Harness,
  childProcess: MockHolder<{ execFile: AnyFn; execFileSync: AnyFn }>,
  store: MockHolder<{ listCards: AnyFn }>,
  settings: MockHolder<{ dismissedSessions: AnyFn }>,
) {
  vi.clearAllMocks();
  h.board = [];
  vi.mocked(store.listCards).mockImplementation(() => h.board);
  vi.mocked(settings.dismissedSessions).mockReturnValue([]);
  fs.rmSync(`${config}/projects`, { recursive: true, force: true });
  fs.rmSync(runningDir, { recursive: true, force: true });
  psMock(childProcess);
  // Reset the welcome mock to the default: a board that has answered the welcome, so a fresh test
  // board adds cards (the gate tests reset it again per-test through setWelcome).
  welcomeMock.welcomeOrAdopt.mockReturnValue({ at: 0, countHistory: true, fresh: false, skip: [] });
  welcomeMock.importsSession.mockImplementation(() => true);
}
