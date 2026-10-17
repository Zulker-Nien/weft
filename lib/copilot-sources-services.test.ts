import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activityMock,
  browserToolsMock,
  commitPileMock,
  execFileMock,
  gh,
  qualityMock,
  scoutMock,
  sprintPlanMock,
  storeMock,
  webhooksMock,
} from "./copilot-sources.harness";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-copilot-sources-services-"));

const shell = vi.fn();
const measureQuality = vi.fn();
vi.mock("./store", () => storeMock(dir));
vi.mock("./activity", () => activityMock());
vi.mock("./browser-tools", () => browserToolsMock(shell));
vi.mock("./commit-pile", () => commitPileMock(vi.fn(), vi.fn()));
vi.mock("./quality", () => qualityMock(measureQuality));
vi.mock("./scout", () => scoutMock(vi.fn()));
vi.mock("./sprint-plan", () => sprintPlanMock(vi.fn()));
vi.mock("./webhooks", () => webhooksMock(vi.fn()));
vi.mock("node:child_process", () => ({ execFile: execFileMock() }));

const { vercel, supabase, statusOf, github, resetSourceCaches } = await import("./copilot-sources");

afterEach(() => {
  resetSourceCaches();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  shell.mockReset();
  gh.responses.clear();
  gh.calls = [];
  vi.useRealTimers();
});

describe("vercel source", () => {
  it("emits a line per folder with a latest deploy, with hours rounded", async () => {
    const now = Date.now();
    shell.mockResolvedValueOnce({
      folders: [
        { folder: "/r1", link: { name: "weft", latest: { state: "READY", createdAt: now - 3_600_000 * 5 } } },
        { folder: "/r2", link: { name: null, latest: { state: "BUILDING", createdAt: now } } },
        { folder: "/r3", link: { name: "weft", latest: null } },
        { folder: "/r4", link: null },
      ],
    });
    const lines = await vercel(["/r1", "/r2", "/r3", "/r4"], []);
    expect(lines).toEqual([
      "- r1: latest Vercel deploy of weft is READY, 5h ago",
      "- r2: latest Vercel deploy of the project is BUILDING, 0h ago",
    ]);
  });

  it("skips folders with an undefined link or latest deploy", async () => {
    shell.mockResolvedValueOnce({ folders: [{ folder: "/r1" }, { folder: "/r2", link: {} }] });
    expect(await vercel(["/r1", "/r2"], [])).toEqual([]);
  });

  it("returns [] when the response has no folders field", async () => {
    shell.mockResolvedValueOnce({});
    expect(await vercel(["/r1"], [])).toEqual([]);
  });
});

describe("supabase source", () => {
  it("emits lines for pending migrations and a non-healthy status", async () => {
    shell.mockResolvedValueOnce({
      folders: [
        { folder: "/r1", link: { name: "weft", pending: ["001_init", "002_users"], status: "ACTIVE_HEALTHY" } },
        { folder: "/r2", link: { name: "weft", pending: [], status: "INACTIVE" } },
        { folder: "/r3", link: null },
        { folder: "/r4", link: { name: "weft", pending: undefined, status: "ACTIVE_HEALTHY" } },
      ],
    });
    const lines = await supabase(["/r1", "/r2", "/r3", "/r4"], []);
    expect(lines).toEqual([
      "- r1: 2 Supabase migrations not applied (001_init, 002_users)",
      "- r2: Supabase project weft is INACTIVE",
    ]);
  });

  it("returns [] when the response has no folders field or only healthy links", async () => {
    shell.mockResolvedValueOnce({});
    expect(await supabase(["/r1"], [])).toEqual([]);
    shell.mockResolvedValueOnce({ folders: [{ folder: "/r2", link: { name: undefined, pending: [], status: "ACTIVE_HEALTHY" } }] });
    expect(await supabase(["/r2"], [])).toEqual([]);
  });

  it("falls back to an empty project name when the link name is undefined", async () => {
    shell.mockResolvedValueOnce({ folders: [{ folder: "/r3", link: { name: null, pending: [], status: "INACTIVE" } }] });
    expect(await supabase(["/r3"], [])).toEqual(["- r3: Supabase project  is INACTIVE"]);
  });
});

describe("statusOf caching", () => {
  it("caches the response for 60s and reuses the same promise", async () => {
    let calls = 0;
    shell.mockImplementation(() => {
      calls += 1;
      return Promise.resolve({ folders: [] });
    });
    const projects = ["/r1"];
    const a = statusOf("/vercel/status", projects);
    const b = statusOf("/vercel/status", projects);
    expect(a).toBe(b);
    await a;
    await b;
    expect(calls).toBe(1);
    expect(shell).toHaveBeenCalledTimes(1);
  });

  it("makes a fresh call after the 60s cache window", async () => {
    vi.useFakeTimers();
    let calls = 0;
    shell.mockImplementation(() => {
      calls += 1;
      return Promise.resolve({ folders: [] });
    });
    const projects = ["/r2"];
    const first = statusOf("/supabase/status", projects);
    await first;
    expect(calls).toBe(1);
    vi.advanceTimersByTime(60_001);
    const second = statusOf("/supabase/status", projects);
    await second;
    expect(calls).toBe(2);
  });

  it("uses different cache keys for different routes", async () => {
    let calls = 0;
    shell.mockImplementation(() => {
      calls += 1;
      return Promise.resolve({ folders: [] });
    });
    const v = statusOf("/vercel/status", ["/r3"]);
    const s = statusOf("/supabase/status", ["/r3"]);
    await v;
    await s;
    expect(calls).toBe(2);
  });

  it("uses different cache keys for different project lists", async () => {
    let calls = 0;
    shell.mockImplementation(() => {
      calls += 1;
      return Promise.resolve({ folders: [] });
    });
    const a = statusOf("/vercel/status", ["/r4"]);
    const b = statusOf("/vercel/status", ["/r4", "/r5"]);
    await a;
    await b;
    expect(calls).toBe(2);
  });

  it("drops a failed call from the cache and retries on the next call", async () => {
    let calls = 0;
    shell.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("service down"));
      return Promise.resolve({ folders: [] });
    });
    const first = statusOf("/vercel/status", ["/r6"]);
    await expect(first).rejects.toThrow("service down");
    expect(calls).toBe(1);
    const second = statusOf("/vercel/status", ["/r6"]);
    await second;
    expect(calls).toBe(2);
  });
});

describe("github source", () => {
  it("parses PR and issue lists, marks drafts, and caches the result", async () => {
    gh.responses.set("pr", {
      out: JSON.stringify([
        { number: 1, title: "Add login", isDraft: false },
        { number: 2, title: "WIP", isDraft: true },
      ]),
    });
    gh.responses.set("issue", { out: JSON.stringify([{ number: 10, title: "Bug" }]) });
    const lines1 = await github(["/r1"], []);
    expect(lines1).toEqual([
      '- r1: open PR #1 "Add login"',
      '- r1: open PR #2 "WIP" (draft)',
      '- r1: open issue #10 "Bug"',
    ]);
    const callsAfterFirst = gh.calls.length;
    const lines2 = await github(["/r1"], []);
    expect(lines2).toEqual(lines1);
    expect(gh.calls.length).toBe(callsAfterFirst);
  });

  it("returns [] when gh fails for both lists", async () => {
    gh.responses.set("pr", { err: new Error("not signed in") });
    gh.responses.set("issue", { err: new Error("not signed in") });
    expect(await github(["/no-cache-1"], [])).toEqual([]);
  });

  it("returns [] when the output isn't JSON", async () => {
    gh.responses.set("pr", { out: "not json" });
    gh.responses.set("issue", { out: "also not json" });
    expect(await github(["/no-cache-2"], [])).toEqual([]);
  });

  it("caches per root so a second root makes fresh calls", async () => {
    gh.responses.set("pr", { out: "[]" });
    gh.responses.set("issue", { out: "[]" });
    await github(["/root-a"], []);
    const callsA = gh.calls.length;
    await github(["/root-b"], []);
    expect(gh.calls.length).toBeGreaterThan(callsA);
  });
});
