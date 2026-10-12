import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "./dotenv.cjs";
import { createEnvWatcher, HEADER, ignoreLocalEnv, isManaged, planWrite, quote, readOrNull, renderEnv, writeFileAtomic } from "./env-writeback.cjs";
import * as sodium from "./vault-crypto.cjs";
import { createVault } from "./vault.cjs";

const LOCAL = ".env.local";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-wb-"));

describe("renderEnv and quote", () => {
  it("writes the header, sorted names, quoted values that parse back, and missing names as comments", () => {
    const values = { B: "plain-value_1.2:3/4", A: 'has "quotes" and \\ and\nnewline', C: "with space # hash", D: "" };
    const text = renderEnv([...Object.entries(values).map(([name, value]) => ({ name, value })), { name: "M", value: null }]);
    expect(text.startsWith(HEADER)).toBe(true);
    expect(isManaged(text)).toBe(true);
    expect(text).toContain("# M= (missing");
    const back = Object.fromEntries(parseEnv(text).map((e: { name: string; value: string }) => [e.name, e.value]));
    expect(back).toEqual(values);
    expect(parseEnv(text).map((e: { name: string }) => e.name)).toEqual(["A", "B", "C", "D"]);
    expect(quote("tab\there\r")).toBe('"tab\\there\\r"');
    expect(isManaged("A=1")).toBe(false);
    expect(isManaged(null)).toBe(false);
  });
});

describe("planWrite", () => {
  const values = new Map([["A", "1"]]);
  it("writes a new or managed file, or one the vault already holds", () => {
    expect(planWrite({ current: null, values, tracked: false })).toEqual({ ok: true });
    expect(planWrite({ current: renderEnv([{ name: "OLD", value: "x" }]), values, tracked: false })).toEqual({ ok: true });
    expect(planWrite({ current: "A=1\n", values, tracked: false })).toEqual({ ok: true });
  });

  it("refuses a tracked file, or values the vault doesn't hold", () => {
    expect(planWrite({ current: null, values, tracked: true }).reason).toMatch(/git tracks/);
    expect(planWrite({ current: "A=2\n", values, tracked: false })).toMatchObject({ ok: false, pending: ["A"], reason: expect.stringMatching(/^1 value in .env.local isn't in the vault yet \(A\): import it first/) as unknown });
    expect(planWrite({ current: "A=2\nB=3\n", values, tracked: false }).reason).toMatch(/^2 values .* aren't .*\(A, B\): import them first/);
  });
});

describe("files", () => {
  it("writes atomically with mode 0600 and reads missing files as null", () => {
    const file = path.join(tmp(), LOCAL);
    expect(readOrNull(file)).toBeNull();
    writeFileAtomic(file, "A=1\n");
    expect(readOrNull(file)).toBe("A=1\n");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("adds .env*.local to a .gitignore, with or without one", () => {
    const a = tmp();
    ignoreLocalEnv(a);
    expect(fs.readFileSync(path.join(a, ".gitignore"), "utf8")).toMatch(/^# Local env files.*\n\.env\*\.local\n$/);
    const b = tmp();
    fs.writeFileSync(path.join(b, ".gitignore"), "node_modules");
    ignoreLocalEnv(b);
    expect(fs.readFileSync(path.join(b, ".gitignore"), "utf8")).toMatch(/^node_modules\n# Local/);
    const c = tmp();
    fs.writeFileSync(path.join(c, ".gitignore"), "dist\n");
    ignoreLocalEnv(c);
    expect(fs.readFileSync(path.join(c, ".gitignore"), "utf8")).toMatch(/^dist\n# Local/);
  });
});

describe("createEnvWatcher", () => {
  function fakeWatch() {
    const listeners = new Map<string, (event: string, name: string | null) => void>();
    const closed: string[] = [];
    const watch = vi.fn((dir: string, fn: (event: string, name: string | null) => void) => {
      listeners.set(dir, fn);
      return { close: () => closed.push(dir) };
    });
    return { watch, fire: (dir: string, name: string | null = LOCAL) => listeners.get(dir)!("change", name), closed };
  }

  it("reports edits Weft didn't write, once they settle, and closes", () => {
    const folder = tmp();
    const file = path.join(folder, LOCAL);
    const onEdit = vi.fn();
    const w = fakeWatch();
    const timers: (() => void)[] = [];
    const cleared: number[] = [];
    const watcher = createEnvWatcher({ onEdit, watch: w.watch as unknown as typeof fs.watch, setTimer: ((fn: () => void) => timers.push(fn)) as unknown as typeof setTimeout, clearTimer: ((t: number) => cleared.push(t)) as unknown as typeof clearTimeout });
    expect(watcher.watching(folder)).toBe(false);
    fs.writeFileSync(file, "A=1\n");
    watcher.wrote(folder, "A=1\n");
    watcher.wrote(folder, "A=1\n");
    expect(w.watch).toHaveBeenCalledTimes(1);
    expect(watcher.watching(folder)).toBe(true);
    w.fire(folder, "other.txt");
    expect(timers).toHaveLength(0);
    w.fire(folder);
    w.fire(folder, null);
    expect(cleared).toHaveLength(1);
    timers[1]!();
    expect(onEdit).not.toHaveBeenCalled();
    fs.writeFileSync(file, "A=2\n");
    w.fire(folder);
    timers[2]!();
    expect(onEdit).toHaveBeenCalledWith(folder);
    fs.rmSync(file);
    w.fire(folder);
    timers[3]!();
    expect(onEdit).toHaveBeenCalledTimes(1);
    w.fire(folder);
    watcher.close();
    expect(w.closed).toEqual([folder]);
    expect(watcher.watching(folder)).toBe(false);
  });

  it("skips a file it can't watch, and uses fs.watch and real timers by default", async () => {
    const throwing = createEnvWatcher({ onEdit: vi.fn(), watch: () => {
      throw new Error("ENOENT");
    } });
    throwing.wrote(tmp(), "x");
    const folder = tmp();
    fs.writeFileSync(path.join(folder, LOCAL), "A=1\n");
    const onEdit = vi.fn();
    const real = createEnvWatcher({ onEdit, settleMs: 10 });
    real.wrote(folder, "A=1\n");
    // Weft's own write renames a new file in; an edit after that still counts.
    writeFileAtomic(path.join(folder, LOCAL), "A=1\n");
    await new Promise((r) => setTimeout(r, 100));
    expect(onEdit).not.toHaveBeenCalled();
    fs.writeFileSync(path.join(folder, LOCAL), "A=2\n");
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledWith(folder), { timeout: 3000 });
    real.close();
  });
});

describe("vault.writeBack", () => {
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`w:${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(2),
  };

  function setup({ repo = true, tracked = "", ignored = true, remote = (): string => "git@github.com:o/r.git" }: { repo?: boolean; tracked?: string; ignored?: boolean; remote?: (folder: string) => string } = {}) {
    const folder = tmp();
    const dataDir = tmp();
    const onChange = vi.fn();
    const listeners: ((event: string, name: string) => void)[] = [];
    const watch = vi.fn((_dir: string, fn: (event: string, name: string) => void) => {
      listeners.push(fn);
      return { close: () => undefined };
    });
    const run = vi.fn((f: string, args: string[]) => {
      const answers: Record<string, string | null> = { remote: remote(f), "rev-parse": repo ? "true\n" : null, "ls-files": tracked, "check-ignore": ignored ? "" : null };
      return Promise.resolve(answers[args[0]!] ?? null);
    });
    const clipboard = { writeText: vi.fn(), readText: () => "" };
    const vault = createVault({ dataDir, safeStorage, sodium, prompt: () => Promise.resolve(true), clipboard, run, onChange, watch: watch as unknown as typeof fs.watch });
    const file = path.join(folder, LOCAL);
    return { folder, vault, onChange, watch, listeners, file, read: () => fs.readFileSync(file, "utf8") };
  }

  it("takes over .env.local, keeps it in step with the vault, and reports hand edits", async () => {
    const { folder, vault, file, read, onChange, listeners } = setup();
    fs.writeFileSync(file, "A=one\nB=two\n");
    fs.writeFileSync(path.join(folder, ".env.example"), "A=\nNEEDED=\n");
    expect((await vault.writeBack(folder)).refused).toMatch(/2 values/);
    await vault.importPicks(folder, [
      { file: LOCAL, name: "A" },
      { file: LOCAL, name: "B" },
      { file: ".env.example", name: "NEEDED" },
    ]);
    expect(read()).toBe("A=one\nB=two\n");
    expect(await vault.writeBack(folder)).toEqual({ written: true, file: LOCAL, gitignoreAdded: false });
    expect(isManaged(read())).toBe(true);
    expect(read()).toContain("# NEEDED= (missing");

    // The vault changes: the file follows, and Weft's own write isn't an edit.
    await vault.setValue(folder, "C", "development", "three");
    await vault.setValue(folder, "P", "production", "prod-only");
    expect(read()).toContain("C=three");
    expect(read()).not.toContain("prod-only");
    await vault.remove("github:o/r", "B", "development");
    expect(read()).not.toContain("B=two");

    const { vaults } = await vault.overview([folder]);
    expect(vaults[0]).toMatchObject({ managed: true, nudge: null });

    // A hand edit: the watcher tells the board, and the nudge offers it as a managed file's change.
    fs.writeFileSync(file, read().replace("C=three", "C=changed"));
    listeners[0]!("change", LOCAL);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(folder));
    expect((await vault.overview([folder])).vaults[0]!.nudge).toEqual({ count: 1, file: LOCAL, managed: true });
    await vault.importPicks(folder, [{ file: LOCAL, name: "C" }]);
    expect(read()).toContain("C=changed");
    vault.close();
  });

  it("follows copies into another project's managed file", async () => {
    const other = tmp();
    const a = setup({ remote: (f) => (f === other ? "git@github.com:o/other.git" : "git@github.com:o/r.git") });
    await a.vault.setValue(a.folder, "K", "development", "kv");
    fs.writeFileSync(path.join(other, LOCAL), renderEnv([]));
    await a.vault.overview([other]);
    const result = await a.vault.copyTo("github:o/r", "K", "development", other);
    expect(result).toMatchObject({ copied: true });
    expect(fs.readFileSync(path.join(other, LOCAL), "utf8")).toContain("K=kv");
  });

  it("adds the .gitignore line when git doesn't ignore the file, skips it outside a repo, and refuses a tracked file", async () => {
    const unignored = setup({ ignored: false });
    expect(await unignored.vault.writeBack(unignored.folder)).toEqual({ written: true, file: LOCAL, gitignoreAdded: true });
    expect(fs.readFileSync(path.join(unignored.folder, ".gitignore"), "utf8")).toContain(".env*.local");

    const outside = setup({ repo: false, ignored: false });
    expect(await outside.vault.writeBack(outside.folder)).toMatchObject({ written: true, gitignoreAdded: false });
    expect(fs.existsSync(path.join(outside.folder, ".gitignore"))).toBe(false);

    const tracked = setup({ tracked: `${LOCAL}\n` });
    expect((await tracked.vault.writeBack(tracked.folder)).refused).toMatch(/git tracks/);
  });

  it("picks up a managed file's watch after a restart", async () => {
    const { folder, vault, watch, file } = setup();
    fs.writeFileSync(file, renderEnv([]));
    await vault.overview([folder]);
    await vault.overview([folder]);
    expect(watch).toHaveBeenCalledTimes(1);
  });
});
