import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({ roleCan: vi.fn() }));
vi.mock("@aimhuge/teams", () => teamsMock);

import { listTeamProjects, runLinkProject, runUnlinkProject } from "./team-projects";
import { ORG, USER } from "./team-ops.harness";

// A thenable chain: the last call in a query resolves to `result`.
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "maybeSingle", "insert", "delete"]) c[m] = vi.fn(() => c);
  Object.defineProperty(c, "then", { value: (r: (v: unknown) => void) => Promise.resolve(result).then(r) });
  return c;
}
function ctxWith(results: unknown[], role: "owner" | "member" = "owner") {
  const chains = results.map(chain);
  const from = vi.fn(() => chains.shift() ?? chain({ data: null, error: null }));
  return { ctx: { user: USER, org: ORG, role, orgs: [ORG], service: { from } as never }, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  teamsMock.roleCan.mockImplementation((role: string) => role !== "member");
});

describe("listTeamProjects", () => {
  it("maps rows, sorted by repo", async () => {
    const { ctx } = ctxWith([
      { data: [{ repo: "b/z", created_at: "t2", added_by: "u1" }, { repo: "a/y", created_at: "t1", added_by: null }] },
    ]);
    expect(await listTeamProjects(ctx)).toEqual([
      { repo: "a/y", addedAt: "t1", addedBy: null },
      { repo: "b/z", addedAt: "t2", addedBy: "u1" },
    ]);
  });

  it("is empty when there is no data", async () => {
    const { ctx } = ctxWith([{ data: null }]);
    expect(await listTeamProjects(ctx)).toEqual([]);
  });
});

describe("runLinkProject", () => {
  it("refuses members", async () => {
    const { ctx, from } = ctxWith([], "member");
    expect((await runLinkProject(ctx, "a/b")).ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a repo that isn't owner/name", async () => {
    const { ctx } = ctxWith([]);
    expect(await runLinkProject(ctx, "nope")).toEqual({ ok: false, message: "Use the owner/name form, like acme/site." });
  });

  it("is idempotent when already linked", async () => {
    const { ctx, from } = ctxWith([{ data: { repo: "a/b" } }]);
    expect(await runLinkProject(ctx, " a/b ")).toEqual({ ok: true, message: "Already linked." });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("inserts a new link with the viewer as adder", async () => {
    const { ctx, from } = ctxWith([{ data: null }, { error: null }]);
    expect(await runLinkProject(ctx, "a/b")).toEqual({ ok: true, message: "Linked a/b." });
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("reports an insert error", async () => {
    const { ctx } = ctxWith([{ data: null }, { error: { message: "boom" } }]);
    expect(await runLinkProject(ctx, "a/b")).toEqual({ ok: false, message: "Could not link project: boom" });
  });
});

describe("runUnlinkProject", () => {
  it("refuses members and bad repos", async () => {
    expect((await runUnlinkProject(ctxWith([], "member").ctx, "a/b")).ok).toBe(false);
    expect((await runUnlinkProject(ctxWith([]).ctx, "x")).ok).toBe(false);
  });

  it("deletes the link", async () => {
    const { ctx } = ctxWith([{ error: null }]);
    expect(await runUnlinkProject(ctx, "a/b")).toEqual({ ok: true, message: "Unlinked a/b." });
  });

  it("reports a delete error", async () => {
    const { ctx } = ctxWith([{ error: { message: "boom" } }]);
    expect(await runUnlinkProject(ctx, "a/b")).toEqual({ ok: false, message: "Could not unlink project: boom" });
  });
});
