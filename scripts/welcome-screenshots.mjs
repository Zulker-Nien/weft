#!/usr/bin/env node
// Captures the three WelcomeIntro screens as real screenshots of a running demo board, by driving
// Chrome through the DevTools Protocol. The plain `--screenshot` flag hung because the board keeps
// long-lived connections that never resolve, so Chrome waits for the page to fully idle. CDP gives
// us Page.captureScreenshot on demand, after we wait for an explicit DOM marker (a CSS selector).
//
// Usage:
//   node scripts/welcome-screenshots.mjs [--port=3999] [--out=/Users/fotoflo/.weft/show/welcome-screenshots]
//
// Each entry in SCREENS is one capture: { name, url, viewport, marker, setup, clicks }. setup is a
// function (port) that mutates the demo board state before the page loads (e.g. set welcome to
// "test"); clicks is an array of CSS selectors to click after the marker appears, with a wait
// between each. The screenshot fires after clicks settle.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { WebSocket } from "ws";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9222;
const TOKEN = "1";

const SCREENS = [
  {
    name: "01-welcome.png",
    url: "/",
    viewport: { width: 1280, height: 800 },
    marker: '[role="dialog"]',
    // Show the welcome dialog by setting the test flag on the demo board.
    setup: async (port) => patchWelcome(port, { test: true }),
    delay: 600,
  },
  {
    name: "02-empty-board.png",
    url: "/",
    viewport: { width: 1280, height: 800 },
    marker: '[data-column="done"]',
    // Answer the welcome with `fresh: true` and `at: now` so the session sync adds no cards. The
    // board shows just the copilot card, which lives in the Backlog column not yet rendered.
    setup: async (port) => postWelcome(port, { countHistory: true, fresh: true, skip: [] }),
    delay: 600,
  },
  {
    name: "03-left-bar.png",
    url: "/",
    viewport: { width: 1280, height: 800 },
    marker: '[data-column="done"]',
    // Same as the empty board, then click the Tags rail button to open its drawer. The button's
    // accessible name lives in a <span class="sr-only">Tags</span>, so we target by title.
    setup: async (port) => postWelcome(port, { countHistory: true, fresh: true, skip: [] }),
    clicks: ['nav[aria-label="Rail"] button[title*="Tags"]'],
    clickDelay: 800,
    delay: 600,
  },
];

function parseArgs(argv) {
  const out = { port: "3999", outDir: "/Users/fotoflo/.weft/show/welcome-screenshots" };
  for (const arg of argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k in out) out[k] = v;
  }
  return out;
}

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      url,
      { method, headers: { "x-weft-token": TOKEN, ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const patchWelcome = (port, body) => request("PATCH", `http://127.0.0.1:${port}/api/welcome`, body);
const postWelcome = (port, body) => request("POST", `http://127.0.0.1:${port}/api/welcome`, body);

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
    });
  });
}

// One client multiplexes every CDP message on a single WebSocket. We track pending calls by id and
// route events by method name, exposing send() for calls and on() for events. Calls land at the
// browser endpoint unless a sessionId is given, in which case they ride the page session.
class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      }
      if (msg.method) {
        const list = this.handlers.get(msg.method);
        if (list) for (const h of list) h(msg.params, msg.sessionId);
      }
    });
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function captureOne(client, port, outDir, screen) {
  // Per-screen setup: mutate the demo board so the right state shows on load (welcome dialog
  // visible, welcome dismissed, etc.). The setup runs BEFORE the page navigates so the page's
  // first render already reflects the state.
  if (screen.setup) {
    try {
      await screen.setup(port);
    } catch (err) {
      console.warn(`[shots] setup for ${screen.name} failed:`, err.message);
    }
  }

  // New browser context so cookies / localStorage don't leak between captures.
  const { browserContextId } = await client.send("Target.createBrowserContext");
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => client.send(method, params, sessionId);

  await send("Emulation.setDeviceMetricsOverride", {
    width: screen.viewport.width,
    height: screen.viewport.height,
    deviceScaleFactor: 2, // 2x for crisp text; 1280×800 → 2560×1600 PNG
    mobile: false,
  });

  const navP = new Promise((resolve) => client.on("Page.loadEventFired", resolve));
  await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}${screen.url}` });
  await navP;

  // Poll the DOM for the marker. The welcome dialog loads via guarded()'s dynamic import, then
  // loadWelcome() fetches the preview — that chain can take 5–8 s on a cold dev build. Give it
  // 20 s; fail with a warning if the marker never appears.
  const t0 = Date.now();
  let matched = false;
  while (Date.now() - t0 < 20000) {
    const { result } = await send("Runtime.evaluate", {
      expression: `!!document.querySelector(${JSON.stringify(screen.marker)})`,
      returnByValue: true,
    });
    if (result.value === true) {
      matched = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!matched) console.warn(`warning: marker ${screen.marker} did not appear for ${screen.name}`);

  // Optional clicks (e.g. open a rail drawer).
  for (const sel of screen.clicks ?? []) {
    const clicked = await send("Runtime.evaluate", {
      expression: `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;el.click();return true;})()`,
      returnByValue: true,
    });
    if (!clicked.result.value) console.warn(`warning: ${sel} not found for ${screen.name}`);
    if (screen.clickDelay) await new Promise((r) => setTimeout(r, screen.clickDelay));
  }

  if (screen.delay) await new Promise((r) => setTimeout(r, screen.delay));

  // Capture the full viewport to PNG.
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const outPath = path.join(outDir, screen.name);
  fs.writeFileSync(outPath, Buffer.from(data, "base64"));
  console.log(`captured ${screen.name} → ${outPath}`);

  await client.send("Target.closeTarget", { targetId });
  await client.send("Target.disposeBrowserContext", { browserContextId });
}

async function main() {
  const args = parseArgs(process.argv);
  fs.mkdirSync(args.outDir, { recursive: true });

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-shots-"));
  console.log(`[shots] profile ${profileDir}`);
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,InfiniteSessionRestore",
      "--hide-scrollbars",
      "--window-size=1280,800",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  child.on("error", (e) => console.error("[shots] chrome error:", e));

  // Wait for "DevTools listening" on stderr (the port is not open before this).
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not announce DevTools in 30 s")), 30000);
    let buf = "";
    const onChunk = (chunk) => {
      buf += chunk.toString("utf8");
      if (/DevTools listening on/i.test(buf)) {
        clearTimeout(timer);
        child.stderr.off("data", onChunk);
        child.stdout.off("data", onChunk);
        resolve();
      }
    };
    child.stderr.on("data", onChunk);
    child.stdout.on("data", onChunk);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited with code ${code} before DevTools came up`));
    });
  });
  console.log("[shots] chrome ready");

  try {
    const v = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const wsUrl = v.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error("Chrome /json/version did not return webSocketDebuggerUrl");
    console.log(`[shots] connecting to ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", (e) => reject(e));
    });
    console.log("[shots] ws open");
    const client = new CdpClient(ws);
    for (const screen of SCREENS) {
      console.log(`[shots] -> ${screen.name}`);
      await captureOne(client, args.port, args.outDir, screen);
    }
    ws.close();
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});