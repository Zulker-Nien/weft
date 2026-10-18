import { afterEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync }));

import { descendantGroups, findDescendantGroups, parseTree, signalGroups } from "./process-tree";

afterEach(() => vi.restoreAllMocks());

describe("parseTree", () => {
  it("parses rows and skips garbage", () => {
    expect(parseTree("  10   1  10\n\nnope\n 11 10 11\n")).toEqual([
      { pid: 10, ppid: 1, pgid: 10 },
      { pid: 11, ppid: 10, pgid: 11 },
    ]);
  });
});

describe("descendantGroups", () => {
  // The CLI (group 10) runs two Bash commands in groups 20 and 30; 30's vitest has workers in its group.
  const tree = [
    { pid: 10, ppid: 1, pgid: 10 },
    { pid: 12, ppid: 10, pgid: 10 },
    { pid: 20, ppid: 10, pgid: 20 },
    { pid: 30, ppid: 12, pgid: 30 },
    { pid: 31, ppid: 30, pgid: 30 },
    { pid: 32, ppid: 31, pgid: 30 },
    { pid: 40, ppid: 1, pgid: 40 },
  ];

  it("finds the groups below any member of the CLI's group, not the group itself or strangers", () => {
    expect(descendantGroups(10, tree).sort()).toEqual([20, 30]);
  });

  it("has nothing for a group with no processes", () => {
    expect(descendantGroups(99, tree)).toEqual([]);
  });

  it("stops on a loop in a stale ps listing", () => {
    expect(descendantGroups(5, [{ pid: 5, ppid: 6, pgid: 5 }, { pid: 6, ppid: 5, pgid: 6 }])).toEqual([6]);
  });
});

describe("findDescendantGroups", () => {
  it("reads ps", () => {
    execFileSync.mockReturnValue("10 1 10\n20 10 20\n");
    expect(findDescendantGroups(10)).toEqual([20]);
  });

  it("is empty when ps fails", () => {
    execFileSync.mockImplementation(() => {
      throw new Error("no ps");
    });
    expect(findDescendantGroups(10)).toEqual([]);
  });

  it("is empty on win32", () => {
    const real = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      execFileSync.mockReset();
      expect(findDescendantGroups(10)).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", real);
    }
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

describe("signalGroups", () => {
  it("signals each group and shrugs off one that's gone", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === -30) throw new Error("ESRCH");
      return true;
    });
    signalGroups([20, 30], "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-20, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-30, "SIGTERM");
  });
});
