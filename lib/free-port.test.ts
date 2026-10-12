import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { freePort } from "../electron/free-port.cjs";

function freeTcpPort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function squat(port: number) {
  const child = spawn(process.execPath, ["-e", `require("net").createServer().listen(${port}, "127.0.0.1")`], { stdio: "ignore" });
  return new Promise<typeof child>((resolve) => {
    const tryConnect = () => {
      const socket = net.connect(port, "127.0.0.1", () => socket.end(() => resolve(child)));
      socket.on("error", () => setTimeout(tryConnect, 50));
    };
    tryConnect();
  });
}

const exited = (child: ReturnType<typeof spawn>) =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((r) => child.once("exit", r));

describe("freePort", () => {
  it("kills whatever listens on the port", async () => {
    const port = await freeTcpPort();
    const child = await squat(port);
    freePort(port);
    await exited(child);
    expect(child.signalCode).not.toBeNull();
  });

  it("does nothing when the port is already free", async () => {
    const port = await freeTcpPort();
    expect(() => freePort(port)).not.toThrow();
  });

  const buildFolder = () => path.relative(path.join(__dirname, ".."), fs.mkdtempSync(path.join(os.tmpdir(), "weft-dist-")));

  it("keeps the build folder, and Turbopack's cache, when nothing held the port", async () => {
    const rel = buildFolder();
    freePort(await freeTcpPort(), rel);
    expect(fs.existsSync(path.join(__dirname, "..", rel))).toBe(true);
    fs.rmSync(path.join(__dirname, "..", rel), { recursive: true });
  });

  it("removes the build folder a stale server wrote", async () => {
    const rel = buildFolder();
    const port = await freeTcpPort();
    const child = await squat(port);
    freePort(port, rel);
    await exited(child);
    expect(fs.existsSync(path.join(__dirname, "..", rel))).toBe(false);
  });
});
