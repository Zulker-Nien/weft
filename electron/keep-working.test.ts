import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: { showMessageBox: vi.fn() } }));

// The factory spawns pmset through child_process and forks a detached watchdog. Both would error in
// a test sandbox; the public surface tests only need the factory's bookkeeping (state, subscribe,
// onChange fanout) to be observable, so we stub execFile to report "ok" and stub spawn to a no-op.
const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((_file: string, _args: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    cb(null, "", "");
  }),
  spawnMock: vi.fn(() => {
    const child = { pid: 1, unref: vi.fn(), removeAllListeners: vi.fn(), on: vi.fn(), exitCode: null } as never;
    return child;
  }),
}));
vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  execFileSync: vi.fn(),
  spawn: spawnMock,
}));

const kw = await import("./keep-working.cjs");
const { createKeepWorking, menuTemplate, statusText, sudoersLine, trayTitle } = kw;
const HOUR_CHOICES = (kw as unknown as { HOUR_CHOICES: number[] }).HOUR_CHOICES;

const now = new Date(2026, 9, 11, 12, 0).getTime();
const hours = (h: number) => ({ mode: "hours", hours: h, until: now + h * 3_600_000 });

describe("sudoersLine", () => {
  it("allows only pmset disablesleep 0 and 1, without a password", () => {
    expect(sudoersLine("alex")).toBe("alex ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1\n");
  });
});

describe("trayTitle", () => {
  it("is empty when off", () => {
    expect(trayTitle({ mode: "off" }, now)).toBe("");
  });
  it("is a cup until threads finish", () => {
    expect(trayTitle({ mode: "threads", until: now + 1 }, now)).toBe("☕︎");
  });
  it("adds whole hours left, then minutes in the last hour", () => {
    expect(trayTitle(hours(2), now)).toBe("☕︎2h");
    expect(trayTitle({ mode: "hours", hours: 1, until: now + 45 * 60_000 }, now)).toBe("☕︎45m");
    expect(trayTitle({ mode: "hours", hours: 1, until: now - 1 }, now)).toBe("☕︎0m");
  });
});

describe("statusText", () => {
  it("says what the lid does when off", () => {
    expect(statusText({ mode: "off" }, now)).toMatch(/^Off/);
  });
  it("counts running threads once it knows", () => {
    expect(statusText({ mode: "threads", running: null }, now)).toBe("On until threads finish");
    expect(statusText({ mode: "threads", running: 2 }, now)).toBe("On until threads finish (2 running)");
    expect(statusText({ mode: "threads", running: 0 }, now)).toBe("On until threads finish (nothing running)");
  });
  it("gives the end time and time left on a timer", () => {
    expect(statusText({ mode: "hours", hours: 2, until: now + 90 * 60_000 }, now)).toBe("On until 13:30 (1h 30m left)");
  });
});

describe("menuTemplate", () => {
  type Item = { label?: string; enabled?: boolean; checked?: boolean; click?: () => void };
  const actions = () => ({ start: vi.fn(), stop: vi.fn() });
  const items = (m: ReturnType<typeof menuTemplate>) => m.submenu as Item[];
  const by = (m: ReturnType<typeof menuTemplate>, label: string) => items(m).find((i) => i.label === label)!;

  it("offers until threads finish first, then hours, then Off", () => {
    const m = menuTemplate({ mode: "off" }, now, actions());
    expect(m.label).toBe("Keep Working");
    expect(items(m).map((i) => i.label).filter(Boolean).slice(1)).toEqual(["Until threads finish", "For 1 hour", "For 2 hours", "For 3 hours", "For 8 hours", "Off"]);
  });

  it("checks the running choice and enables Off only while on", () => {
    expect(by(menuTemplate({ mode: "off" }, now, actions()), "Off").enabled).toBe(false);
    const on = menuTemplate(hours(3), now, actions());
    expect(items(on).filter((i) => i.checked).map((i) => i.label)).toEqual(["For 3 hours"]);
    expect(by(on, "Off").enabled).toBe(true);
  });

  it("starts and stops through the actions it's given", () => {
    const a = actions();
    const m = menuTemplate({ mode: "threads" }, now, a);
    expect(by(m, "Until threads finish").checked).toBe(true);
    by(m, "Until threads finish").click!();
    by(m, "For 8 hours").click!();
    by(m, "Off").click!();
    expect(a.start.mock.calls).toEqual([["threads"], ["hours", 8]]);
    expect(a.stop).toHaveBeenCalledOnce();
  });
});

describe("createKeepWorking", () => {
  it("exposes the same hour choices the tray shows", () => {
    // Settings → General → Laptop mode renders chips from a copy of this list; the two must agree.
    expect(HOUR_CHOICES).toEqual([1, 2, 3, 8]);
  });

  it("starts as off and fans out onChange alongside subscribers", async () => {
    const onChange = vi.fn();
    const sub = vi.fn();
    const kwInst = createKeepWorking({ getServer: () => null, onChange });
    expect(kwInst.state().mode).toBe("off");
    const unsubscribe = kwInst.subscribe(sub);
    await kwInst.start("hours", 2);
    try {
      expect(kwInst.state().mode).toBe("hours");
      expect(kwInst.state().hours).toBe(2);
      expect(typeof kwInst.state().until).toBe("number");
      expect(onChange).toHaveBeenCalled();
      expect(sub).toHaveBeenCalled();
    } finally {
      await kwInst.stop();
      unsubscribe();
    }
    expect(kwInst.state().mode).toBe("off");
  });

  it("subscribe's unsubscribe stops the subscriber but not onChange", async () => {
    const onChange = vi.fn();
    const sub = vi.fn();
    const kwInst = createKeepWorking({ getServer: () => null, onChange });
    const unsubscribe = kwInst.subscribe(sub);
    unsubscribe();
    await kwInst.start("threads");
    try {
      expect(onChange).toHaveBeenCalled();
      expect(sub).not.toHaveBeenCalled();
    } finally {
      await kwInst.stop();
    }
  });
});
