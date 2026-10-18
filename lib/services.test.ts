import { describe, expect, it } from "vitest";
import {
  buildServices,
  findRoot,
  isWeftOwn,
  parseElapsed,
  parseProcs,
  sessionArg,
  shortCommand,
  sortServices,
  type Context,
  type Known,
  type Proc,
} from "./services";
import type { ServiceEntry } from "./types";

const proc = (over: Partial<Proc> = {}): Proc => ({
  pid: 100,
  ppid: 1,
  pgid: 100,
  cpu: 1.5,
  memKb: 1024,
  elapsed: 0,
  command: "node",
  ...over,
});

const ctx = (over: Partial<Context> = {}): Context => ({ self: 50, known: new Map(), now: 1_000_000, ...over });

describe("sessionArg", () => {
  it("reads --session-id and --resume with = and space", () => {
    expect(sessionArg("claude --session-id abc-123")).toBe("abc-123");
    expect(sessionArg("claude --resume=xyz-456")).toBe("xyz-456");
    expect(sessionArg("claude --resume 789-xyz --cwd /x")).toBe("789-xyz");
  });

  it("returns undefined when no session arg", () => {
    expect(sessionArg("claude --cwd /x")).toBeUndefined();
    expect(sessionArg("")).toBeUndefined();
  });
});

describe("parseProcs", () => {
  it("parses ps rows into procs", () => {
    const out = `  10  1 10  1.5  2048  00:42  node server.js`;
    const rows = parseProcs(out);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ pid: 10, ppid: 1, pgid: 10, cpu: 1.5, memKb: 2048, elapsed: 42, command: "node server.js" });
  });

  it("parses multiple rows, ignoring blanks and bad lines", () => {
    const out = [
      "  10  1 10  1.5  2048  00:42  node server.js",
      "",
      "garbage line that doesn't parse",
      "  20 10 20  0.0   512 01:00:00  vite",
    ].join("\n");
    const rows = parseProcs(out);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.command).toBe("vite");
    expect(rows[1]?.elapsed).toBe(3600);
  });

  it("parses days in etime", () => {
    expect(parseProcs("  1  1  1  0.0  100  02-03:04:05  long").map((r) => r.elapsed)).toEqual([2 * 86400 + 3 * 3600 + 4 * 60 + 5]);
  });
});

describe("parseElapsed", () => {
  it("reads seconds, mm:ss and hh:mm:ss", () => {
    expect(parseElapsed("45")).toBe(45);
    expect(parseElapsed("01:30")).toBe(90);
    expect(parseElapsed("02:30:45")).toBe(2 * 3600 + 30 * 60 + 45);
  });

  it("reads days and clock", () => {
    expect(parseElapsed("01-00:00:00")).toBe(86_400);
    expect(parseElapsed("2-12:34:56")).toBe(2 * 86_400 + 12 * 3600 + 34 * 60 + 56);
  });

  it("returns 0 on junk", () => {
    expect(parseElapsed("not-a-time")).toBe(0);
  });
});

describe("isWeftOwn", () => {
  it("matches Electron, the app bundle, Weft Helper, next-server, .next and crashpad", () => {
    expect(isWeftOwn("/Applications/Weft.app/Contents/MacOS/Weft")).toBe(true);
    expect(isWeftOwn("Weft Helper (Renderer)")).toBe(true);
    expect(isWeftOwn("Electron Helper")).toBe(true);
    expect(isWeftOwn("/repo/node_modules/.bin/next-server")).toBe(true);
    expect(isWeftOwn("/repo/node_modules/next/dist/bin/next")).toBe(true);
    expect(isWeftOwn("/repo/.next/standalone/server.js")).toBe(true);
    expect(isWeftOwn("/Users/me/Library/Application Support/Weft/crashpad/handler")).toBe(true);
  });

  it("does not match an ordinary command", () => {
    expect(isWeftOwn("node script.js")).toBe(false);
    expect(isWeftOwn("claude --resume abc")).toBe(false);
  });
});

describe("findRoot", () => {
  it("returns self when the parent is not Weft", () => {
    const byPid = new Map<number, Proc>([[1, proc({ pid: 1, command: "launchd" })]]);
    expect(findRoot(byPid, 50)).toBe(50);
  });

  it("walks up Weft ancestors to the highest one", () => {
    // launchd -> shell -> Weft -> next-server; the root is the highest Weft ancestor.
    const byPid = new Map<number, Proc>([
      [1, proc({ pid: 1, command: "launchd" })],
      [10, proc({ pid: 10, ppid: 1, command: "loginwindow" })],
      [20, proc({ pid: 20, ppid: 10, command: "/Applications/Weft.app/Contents/MacOS/Weft" })],
      [50, proc({ pid: 50, ppid: 20, command: "next-server" })],
    ]);
    expect(findRoot(byPid, 50)).toBe(20);
  });

  it("stops when the next ancestor is missing", () => {
    const byPid = new Map<number, Proc>([[10, proc({ pid: 10, ppid: 999, command: "Weft Helper" })]]);
    expect(findRoot(byPid, 50)).toBe(50);
  });
});

describe("shortCommand", () => {
  it("uses the basename of the executable", () => {
    expect(shortCommand("/usr/bin/git status --porcelain")).toBe("git status");
    expect(shortCommand("/bin/node script.js")).toBe("node script.js");
  });

  it("strips a leading dash on the executable (login shell)", () => {
    expect(shortCommand("-zsh")).toBe("zsh");
    expect(shortCommand("/bin/-bash")).toBe("bash");
  });

  it("drops args that look like flags or paths", () => {
    expect(shortCommand("/bin/git --version")).toBe("git");
    expect(shortCommand("/bin/node /abs/path.js")).toBe("node");
  });

  it("returns just the name when there is no arg", () => {
    expect(shortCommand("node")).toBe("node");
    expect(shortCommand("")).toBe("");
  });
});

describe("sortServices", () => {
  it("orders by ServiceKind first, then newest first within a kind", () => {
    const a: ServiceEntry = { id: "a", kind: "weft", label: "Weft", state: "running", cpu: 0, memKb: 0, startedAt: 1, procs: [] };
    const b: ServiceEntry = { id: "b", kind: "cli", label: "Claude", state: "running", cpu: 0, memKb: 0, startedAt: 5, procs: [] };
    const c: ServiceEntry = { id: "c", kind: "cli", label: "Puku", state: "running", cpu: 0, memKb: 0, startedAt: 10, procs: [] };
    const d: ServiceEntry = { id: "d", kind: "dev", label: "vite", state: "running", cpu: 0, memKb: 0, startedAt: 2, procs: [] };
    const sorted = sortServices([a, d, c, b]);
    expect(sorted.map((s) => s.id)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("buildServices", () => {
  it("groups children under the parent service, summing cpu and memory", () => {
    // A Weft app bundle, the next server it spawned, and a CLI Weft knows about.
    const procs: Proc[] = [
      proc({ pid: 20, ppid: 1, command: "/Applications/Weft.app/Contents/MacOS/Weft", elapsed: 10 }),
      proc({ pid: 50, ppid: 20, command: "next-server", elapsed: 10 }),
      proc({ pid: 60, ppid: 50, cpu: 2.0, memKb: 2048, command: "node worker.js", elapsed: 10 }),
    ];
    const knownMap = new Map<number, Known>([[60, { kind: "cli", label: "Claude Code", cardId: "c1" }]]);
    const services = buildServices(procs, ctx({ known: knownMap }));
    const cli = services.find((s) => s.kind === "cli");
    expect(cli).toMatchObject({ kind: "cli", label: "Claude Code", cardId: "c1", cpu: 2.0, memKb: 2048 });
    expect(cli?.procs).toHaveLength(1);
    expect(cli?.procs[0]?.pid).toBe(60);
  });

  it("marks the root weft service as weft and orders it last", () => {
    const procs: Proc[] = [proc({ pid: 50, ppid: 1, command: "next-server", elapsed: 10 })];
    const services = buildServices(procs, ctx());
    expect(services).toHaveLength(1);
    expect(services[0]?.kind).toBe("weft");
  });

  it("creates a terminal entry for a direct child of the Weft root that is not Weft", () => {
    const procs: Proc[] = [
      proc({ pid: 20, ppid: 1, command: "/Applications/Weft.app/Contents/MacOS/Weft", elapsed: 10 }),
      proc({ pid: 50, ppid: 20, command: "next-server", elapsed: 10 }),
      proc({ pid: 60, ppid: 20, command: "/bin/zsh", elapsed: 10 }),
    ];
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    const root = findRoot(byPid, 50);
    expect(root).toBe(20);
    const services = buildServices(procs, ctx());
    const terminal = services.find((s) => s.kind === "terminal");
    expect(terminal?.label).toMatch(/Terminal · zsh/);
  });

  it("creates an other entry for descendants not known to the server", () => {
    const procs: Proc[] = [
      proc({ pid: 50, ppid: 1, command: "next-server", elapsed: 10 }),
      proc({ pid: 60, ppid: 50, command: "/usr/bin/random", elapsed: 10 }),
    ];
    const services = buildServices(procs, ctx());
    const other = services.find((s) => s.kind === "other");
    expect(other?.label).toBe("random");
  });

  it("drops the snapshot's own ps", () => {
    const procs: Proc[] = [
      proc({ pid: 50, ppid: 1, command: "next-server", elapsed: 10 }),
      proc({ pid: 99, ppid: 50, command: "/bin/ps -axo pid=,ppid=,pgid=,%cpu=,rss=,etime=,command=", elapsed: 0 }),
    ];
    const services = buildServices(procs, ctx({ self: 50 }));
    expect(services.find((s) => s.procs.some((p) => p.pid === 99))).toBeUndefined();
  });

  it("matches a CLI by session arg through bySession", () => {
    const procs: Proc[] = [
      proc({ pid: 50, ppid: 1, command: "next-server", elapsed: 10 }),
      proc({ pid: 60, ppid: 50, command: "claude --resume sess-1", elapsed: 10 }),
    ];
    const bySession = new Map<string, Known>([["sess-1", { kind: "cli", label: "Claude Code", cardId: "c1" }]]);
    const services = buildServices(procs, ctx({ bySession }));
    expect(services.find((s) => s.kind === "cli")).toMatchObject({ cardId: "c1", label: "Claude Code" });
  });

  it("deduplicates when the same pid is opened twice via the same id", () => {
    const procs: Proc[] = [
      proc({ pid: 50, ppid: 1, command: "next-server", elapsed: 10 }),
      proc({ pid: 60, ppid: 50, command: "/usr/bin/du", elapsed: 10 }),
    ];
    // Two knowns pointing to the same id key would collide; buildServices keys by id and reuses.
    const known = new Map<number, Known>([[60, { kind: "cli", label: "du" }]]);
    const services = buildServices(procs, ctx({ known }));
    expect(services.filter((s) => s.label === "du")).toHaveLength(1);
  });

  it("returns an empty list when the root is absent", () => {
    const services = buildServices([], ctx());
    expect(services).toEqual([]);
  });

  it("returns an existing service when a child opens under a non-weft owner", () => {
    // The first visit attaches 60 to a non-weft owner (set up via known), the second visit
    // of pid 60 reuses it instead of creating another entry.
    const procs: Proc[] = [
      proc({ pid: 20, ppid: 1, command: "/Applications/Weft.app/Contents/MacOS/Weft", elapsed: 10 }),
      proc({ pid: 50, ppid: 20, command: "next-server", elapsed: 10 }),
      proc({ pid: 60, ppid: 50, command: "node worker", elapsed: 10 }),
    ];
    const knownMap = new Map<number, Known>([[60, { kind: "cli", label: "Claude Code", cardId: "c1" }]]);
    const services = buildServices(procs, ctx({ known: knownMap }));
    // The cli entry should have been visited only once: one proc, one entry.
    expect(services.filter((s) => s.kind === "cli")).toHaveLength(1);
    expect(services.find((s) => s.kind === "cli")?.procs).toHaveLength(1);
  });

  it("reuses a service entry when the same id is opened for a second child", () => {
    // Two children both known to the same card id; buildServices reuses the existing entry.
    const procs: Proc[] = [
      proc({ pid: 20, ppid: 1, command: "/Applications/Weft.app/Contents/MacOS/Weft", elapsed: 10 }),
      proc({ pid: 50, ppid: 20, command: "next-server", elapsed: 10 }),
      proc({ pid: 60, ppid: 50, command: "node a", elapsed: 10 }),
      proc({ pid: 61, ppid: 50, command: "node b", elapsed: 10 }),
    ];
    const knownMap = new Map<number, Known>([
      [60, { kind: "cli", label: "Claude Code", cardId: "c1" }],
      [61, { kind: "cli", label: "Claude Code", cardId: "c1" }],
    ]);
    const services = buildServices(procs, ctx({ known: knownMap }));
    expect(services.filter((s) => s.kind === "cli")).toHaveLength(1);
    expect(services.find((s) => s.kind === "cli")?.procs).toHaveLength(2);
  });

  it("attaches a grandchild to the existing non-weft owner service", () => {
    // 60 is a known CLI; 70 is its child, also known. The grandchild should land in the
    // existing cli service because owner is set and not weft.
    const procs: Proc[] = [
      proc({ pid: 20, ppid: 1, command: "/Applications/Weft.app/Contents/MacOS/Weft", elapsed: 10 }),
      proc({ pid: 50, ppid: 20, command: "next-server", elapsed: 10 }),
      proc({ pid: 60, ppid: 50, command: "node cli", elapsed: 10 }),
      proc({ pid: 70, ppid: 60, command: "node grandchild", elapsed: 10 }),
    ];
    const knownMap = new Map<number, Known>([
      [60, { kind: "cli", label: "Claude Code", cardId: "c1" }],
      [70, { kind: "cli", label: "Claude Code", cardId: "c1" }],
    ]);
    const services = buildServices(procs, ctx({ known: knownMap }));
    const cli = services.find((s) => s.kind === "cli");
    expect(cli).toBeDefined();
    expect(cli?.procs.map((p) => p.pid).sort()).toEqual([60, 70]);
  });

  it("rounds the cpu to one decimal", () => {
    const procs: Proc[] = [
      proc({ pid: 50, ppid: 1, command: "next-server", elapsed: 10 }),
      proc({ pid: 60, ppid: 50, cpu: 1.234, command: "/usr/bin/du", elapsed: 10 }),
    ];
    const services = buildServices(procs, ctx());
    expect(services[0]?.cpu).toBe(1.2);
  });
});