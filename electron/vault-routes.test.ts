import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVault } from "./vault.cjs";
import { vaultRoutes as rawRoutes } from "./vault-routes.cjs";

type Route = (body: Record<string, unknown>) => Promise<unknown>;
const vaultRoutes = (get: () => unknown) => rawRoutes(get) as unknown as { "POST /secrets/add-blank": Route; "POST /secrets/set": Route };

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};
const VALUE = "generated-signing-secret-0123456789abcdef";

function make() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-proj-"));
  const prompt = vi.fn(() => Promise.resolve(true));
  const onChange = vi.fn();
  const run = () => Promise.resolve("git@github.com:Owner/Repo.git");
  const clipboard = { writeText: vi.fn(), readText: () => "" };
  const vault = createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run, onChange });
  const routes = vaultRoutes(() => vault);
  const set = (body: Record<string, unknown>) => routes["POST /secrets/set"]({ folder, ...body });
  return { vault, folder, dataDir, prompt, onChange, routes, set };
}

describe("vaultRoutes", () => {
  it("says the vault isn't ready before main has one", () => {
    const routes = vaultRoutes(() => undefined);
    expect(() => routes["POST /secrets/set"]({ folder: "/x", name: "A", value: "v" })).toThrow(/isn't ready yet/);
    expect(() => routes["POST /secrets/add-blank"]({ folder: "/x", names: ["A"] })).toThrow(/isn't ready yet/);
  });

  it("adds blanks for a thread, development by default, with a short hint", async () => {
    const { routes, folder, vault } = make();
    expect(await routes["POST /secrets/add-blank"]({ folder, names: ["A"], hint: "x".repeat(300) })).toEqual({ label: "Owner/Repo", filled: [] });
    await expect(routes["POST /secrets/add-blank"]({ folder, names: "nope", environment: "production" })).rejects.toThrow(/Name at least one/);
    const [a] = (await vault.overview([folder])).vaults[0]!.secrets as { name: string; environment: string; source: string; hint: string }[];
    expect(a).toMatchObject({ name: "A", environment: "development", source: "a thread" });
    expect(a!.hint).toHaveLength(200);
  });

  it("fills a thread's blank with a value it generated, into the right environment, after a Touch ID", async () => {
    const { routes, folder, vault, set, prompt, onChange, dataDir } = make();
    // No vault yet, then a name that isn't there, then a blank in another environment: add_blank comes first.
    expect(await set({ name: "SIGNING", value: VALUE, environment: "production" })).toEqual({ missing: true, label: "Owner/Repo" });
    await routes["POST /secrets/add-blank"]({ folder, names: ["SIGNING"], environment: "production" });
    expect(await set({ name: "OTHER", value: VALUE, environment: "production" })).toEqual({ missing: true, label: "Owner/Repo" });
    expect(await set({ name: "SIGNING", value: VALUE })).toEqual({ missing: true, label: "Owner/Repo" });
    await expect(set({ name: "SIGNING", environment: "production" })).rejects.toThrow(/Give a value for SIGNING/);
    expect(prompt).not.toHaveBeenCalled();

    prompt.mockResolvedValueOnce(false);
    expect(await set({ name: "SIGNING", value: VALUE, environment: "production" })).toEqual({ denied: true, label: "Owner/Repo" });
    expect((await vault.valuesFor(folder, ["SIGNING"], "production")).missing).toEqual(["SIGNING"]);

    onChange.mockClear();
    const ok = await set({ name: "SIGNING", value: VALUE, environment: "production" });
    expect(ok).toEqual({ ok: true, label: "Owner/Repo" });
    expect(JSON.stringify(ok)).not.toContain(VALUE);
    expect(prompt).toHaveBeenLastCalledWith("let a thread set SIGNING (Owner/Repo, production)");
    expect(prompt.mock.calls.flat().join("\n")).not.toContain(VALUE);
    expect(await vault.valuesFor(folder, ["SIGNING"], "production")).toMatchObject({ values: { SIGNING: VALUE }, missing: [] });
    expect((await vault.valuesFor(folder, ["SIGNING"], "development")).values).toEqual({});
    expect(onChange).toHaveBeenCalledWith(folder);
    // On disk: ciphertext only, in 0600 files.
    const dir = path.join(dataDir, "vault");
    for (const f of fs.readdirSync(dir)) {
      expect(fs.readFileSync(path.join(dir, f), "utf8")).not.toContain(VALUE);
      expect(fs.statSync(path.join(dir, f)).mode & 0o777).toBe(0o600);
    }

    // Filled now, so a second set (an overwrite) is refused before any prompt.
    prompt.mockClear();
    expect(await set({ name: "SIGNING", value: "another", environment: "production" })).toEqual({ filled: true, label: "Owner/Repo" });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("asks Touch ID for each set even while the drawer and a thread's fill are unlocked", async () => {
    const { routes, folder, vault, set, prompt } = make();
    await routes["POST /secrets/add-blank"]({ folder, names: ["A", "B"] });
    await vault.setValue(folder, "C", "development", "c");
    await vault.reveal("github:owner/repo", "C", "development");
    await vault.useFor(folder, "C", "development", { card: "c1", site: "a.test" });
    prompt.mockClear();
    await set({ name: "A", value: "a-value" });
    await set({ name: "B", value: "b-value" });
    expect(prompt).toHaveBeenCalledTimes(2);
  });
});
