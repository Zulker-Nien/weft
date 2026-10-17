import { describe, expect, it, vi } from "vitest";

const { createFolderAccess, probe, SETTINGS_URL } = await import("./folder-access.cjs");

const eperm = () => Object.assign(new Error("Operation not permitted"), { code: "EPERM" });

function setup({ readdir = vi.fn().mockRejectedValue(eperm()), response = 0, platform = "darwin" } = {}) {
  const dialog = { showMessageBox: vi.fn().mockResolvedValue({ response }) };
  const shell = { openExternal: vi.fn() };
  const getPath = vi.fn((key: string) => `/Users/me/${key}`);
  const access = createFolderAccess({ app: { getPath }, dialog, shell, platform, readdir });
  return { access, dialog, shell, getPath, readdir };
}

describe("probe", () => {
  it("is granted when the folder lists", async () => {
    expect(await probe("/x", () => Promise.resolve([]))).toBe("granted");
  });
  it("is denied on EPERM and EACCES", async () => {
    expect(await probe("/x", () => Promise.reject(eperm()))).toBe("denied");
    expect(await probe("/x", () => Promise.reject(Object.assign(new Error("no"), { code: "EACCES" })))).toBe("denied");
  });
  it("is missing when the folder isn't there", async () => {
    expect(await probe("/x", () => Promise.reject(Object.assign(new Error("no"), { code: "ENOENT" })))).toBe("missing");
  });
});

describe("ask", () => {
  it("only knows the folders it lists", async () => {
    const { access, readdir, dialog } = setup();
    expect(await access.ask("system32")).toEqual({ status: "unknown", folders: ["downloads", "documents", "desktop"] });
    expect(await access.ask(undefined)).toMatchObject({ status: "unknown" });
    expect(readdir).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("does nothing off macOS", async () => {
    const { access, dialog } = setup({ platform: "linux" });
    expect(await access.ask("Downloads")).toEqual({ status: "unsupported" });
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("stays quiet when the folder lists (macOS's own prompt, answered Yes, lands here)", async () => {
    const { access, dialog, getPath } = setup({ readdir: vi.fn().mockResolvedValue([]) });
    expect(await access.ask(" Downloads ")).toEqual({ status: "granted" });
    expect(getPath).toHaveBeenCalledWith("downloads");
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("reports a folder that isn't there without a dialog", async () => {
    const { access, dialog } = setup({ readdir: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "ENOENT" })) });
    expect(await access.ask("desktop")).toEqual({ status: "missing" });
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("explains a refused folder and opens Files and Folders on Open Settings", async () => {
    const { access, dialog, shell } = setup();
    expect(await access.ask("downloads")).toEqual({ status: "denied", openedSettings: true });
    expect(dialog.showMessageBox).toHaveBeenCalledWith(undefined, expect.objectContaining({ message: expect.stringContaining("Downloads") as string }));
    expect(shell.openExternal).toHaveBeenCalledWith(SETTINGS_URL);
  });

  it("asks every time a thread asks, and leaves Settings closed on Not now", async () => {
    const { access, dialog, shell } = setup({ response: 1 });
    expect(await access.ask("downloads")).toEqual({ status: "denied", openedSettings: false });
    await access.ask("downloads");
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});
