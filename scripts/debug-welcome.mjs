// Debug: trigger the test event after load, see if dialog appears.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { WebSocket } from "ws";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9222;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      res.on("error", reject);
    });
  });
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf8"));
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
      if (msg.method && this.handlers.has(msg.method)) {
        for (const h of this.handlers.get(msg.method)) h(msg.params, msg.sessionId);
      }
    });
  }
  on(m, h) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(h); }
  send(method, params, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function main() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-debug-"));
  const child = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
    "--no-first-run", "--window-size=1280,800", "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("timeout")), 30000);
    const on = (c) => { buf += c.toString("utf8"); if (/DevTools listening on/i.test(buf)) { clearTimeout(t); child.stderr.off("data", on); child.stdout.off("data", on); resolve(); }};
    child.stderr.on("data", on);
    child.stdout.on("data", on);
  });

  const v = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => ws.once("open", r));
  const client = new CdpClient(ws);
  const { browserContextId } = await client.send("Target.createBrowserContext");
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p) => client.send(m, p, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await send("Page.enable");
  client.on("Runtime.exceptionThrown", (p) => console.log("EX", p.exceptionDetails.text, p.exceptionDetails.exception?.description));
  const navP = new Promise((r) => client.on("Page.loadEventFired", r));
  await send("Page.navigate", { url: "http://127.0.0.1:3999/" });
  await navP;
  await new Promise((r) => setTimeout(r, 3000));

  // First: see if dialog rendered
  const before = await send("Runtime.evaluate", { expression: `JSON.stringify({dialog: !!document.querySelector('[role="dialog"]'), modal: !!document.querySelector('.fixed.inset-0'), all: document.body.innerHTML.length})`, returnByValue: true });
  console.log("before event:", before.result.value);

  // Dispatch the test event
  await send("Runtime.evaluate", { expression: `window.dispatchEvent(new CustomEvent('weft:welcome-test'))`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 2000));

  const after = await send("Runtime.evaluate", { expression: `JSON.stringify({dialog: !!document.querySelector('[role="dialog"]'), modal: !!document.querySelector('.fixed.inset-0')})`, returnByValue: true });
  console.log("after event:", after.result.value);

  child.kill("SIGKILL");
  fs.rmSync(profileDir, { recursive: true, force: true });
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });