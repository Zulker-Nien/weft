import { describe, expect, it, vi } from "vitest";
import { createVercelEnv, envRoutes } from "./vercel-env.cjs";

// Vault → Vercel: the names on each side, and a push that only main sees the value of.

function make(envs: { key: string; targets: string[] }[] = []) {
  const vault = {
    names: vi.fn(() =>
      Promise.resolve({
        label: "aimhuge/weft",
        secrets: [
          { name: "KEY", environment: "production", missing: false },
          { name: "KEY", environment: "development", missing: false },
          { name: "TODO", environment: "production", missing: true },
        ],
      }),
    ),
    sendValue: vi.fn((_folder: string, _name: string, _env: string, reason: (label: string) => string, send: (value: string) => Promise<unknown>) =>
      send(`value-for-${reason("aimhuge/weft")}`).then((r) => ({ ...(r as object), label: "aimhuge/weft" })),
    ),
  };
  const vercel = {
    envList: vi.fn(() => Promise.resolve({ project: "weft", envs })),
    envSet: vi.fn(() => Promise.resolve({ pushed: true, project: "weft" })),
  };
  return { env: createVercelEnv({ vercel, vault }), vault, vercel };
}

describe("vercel-env", () => {
  it("lines up the vault's names with Vercel's, by environment", async () => {
    const { env } = make([
      { key: "KEY", targets: ["development", "preview"] },
      { key: "OTHER", targets: ["production", "preview"] },
      { key: "ODD", targets: ["staging"] },
    ]);
    expect(await env.status("/dev/weft")).toEqual({
      label: "aimhuge/weft",
      project: "weft",
      rows: [
        { name: "KEY", environment: "development", inVault: true, onVercel: true },
        { name: "KEY", environment: "preview", inVault: false, onVercel: true },
        { name: "OTHER", environment: "preview", inVault: false, onVercel: true },
        { name: "KEY", environment: "production", inVault: true, onVercel: false },
        { name: "OTHER", environment: "production", inVault: false, onVercel: true },
        { name: "TODO", environment: "production", inVault: false, onVercel: false },
      ],
    });
  });

  it("pushes one value after a Touch ID that names it, the vault, the environment and the project", async () => {
    const { env, vault, vercel } = make();
    expect(await env.push("/dev/weft", "KEY", "production")).toEqual({ pushed: true, project: "weft", label: "aimhuge/weft" });
    expect(vault.sendValue).toHaveBeenCalledWith("/dev/weft", "KEY", "production", expect.any(Function), expect.any(Function));
    expect(vercel.envSet).toHaveBeenCalledWith("/dev/weft", "KEY", "production", "value-for-push KEY (aimhuge/weft, production) to Vercel project weft");
  });

  it("refuses a bad name or environment before asking anyone", async () => {
    const { env, vault } = make();
    await expect(env.push("/dev/weft", "1BAD", "production")).rejects.toThrow("isn't a variable name");
    await expect(env.push("/dev/weft", "", "production")).rejects.toThrow("A blank name");
    await expect(env.push("/dev/weft", "KEY", "staging")).rejects.toThrow("Unknown environment");
    expect(vault.sendValue).not.toHaveBeenCalled();
  });

  it("gives threads a status and a push route", async () => {
    const env = { status: vi.fn(() => Promise.resolve({})), push: vi.fn(() => Promise.resolve({})) };
    const routes = envRoutes(() => env);
    await routes["POST /vercel/env-status"]({ folder: "/dev/weft" });
    await routes["POST /vercel/env-push"]({ folder: "/dev/weft", name: "KEY", environment: undefined });
    expect(env.status).toHaveBeenCalledWith("/dev/weft");
    expect(env.push).toHaveBeenCalledWith("/dev/weft", "KEY", "");
  });
});
