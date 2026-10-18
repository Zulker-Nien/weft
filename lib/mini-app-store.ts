import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";
import { appNameFrom, cleanAppName, cleanAppUrl, moveApp, upsertApp, type MiniApp } from "./mini-apps";
import type { CardShareMemo } from "./types-card-detail";

// The left rail's mini apps (lib/mini-apps.ts), in their order, in ~/.weft/apps.json.

// Read when used, not at import, so routes that only pass through here load without the store.
const appsFile = () => path.join(DATA_DIR, "apps.json");

export function listApps(): MiniApp[] {
  try {
    const apps = (JSON.parse(fs.readFileSync(appsFile(), "utf8")) as { apps?: MiniApp[] }).apps;
    return Array.isArray(apps) ? apps : [];
  } catch {
    return [];
  }
}

function writeApps(apps: MiniApp[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(appsFile(), JSON.stringify({ apps }, null, 2));
}

function find(apps: readonly MiniApp[], id: unknown): MiniApp {
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error("No such app.");
  return app;
}

// A page saved as an app; saving one that's already there renames it.
export function saveApp(rawUrl: unknown, rawName?: unknown): MiniApp {
  const url = cleanAppUrl(rawUrl);
  if (!url) throw new Error("An app is a web page or a local file (http, https or file).");
  const saved = listApps();
  const named = cleanAppName(rawName);
  const already = saved.find((a) => a.url === url);
  if (already && !named) return already;
  const name = named ?? appNameFrom(undefined, url);
  const apps = upsertApp(saved, { id: crypto.randomUUID(), name, url, addedAt: Date.now() });
  writeApps(apps);
  return find(apps, apps.find((a) => a.url === url)?.id);
}

// { name } renames it; { to } moves it to that place on the rail.
export function updateApp(id: unknown, patch: { name?: unknown; to?: unknown }): MiniApp {
  let apps = listApps();
  const app = find(apps, id);
  if (patch.name !== undefined) {
    const name = cleanAppName(patch.name);
    if (!name) throw new Error("An app needs a name.");
    apps = apps.map((a) => (a.id === app.id ? { ...a, name } : a));
  }
  if (patch.to !== undefined) {
    if (typeof patch.to !== "number" || !Number.isInteger(patch.to)) throw new Error("to is a position.");
    apps = moveApp(apps, app.id, patch.to);
  }
  writeApps(apps);
  return find(apps, app.id);
}

export function removeApp(id: unknown) {
  const apps = listApps();
  find(apps, id);
  writeApps(apps.filter((a) => a.id !== id));
}

// The app's share link as Supabase last answered it (lib/app-share.ts); written only when it changed.
export function rememberAppShare(id: string, share: CardShareMemo) {
  const apps = listApps();
  const had = apps.find((a) => a.id === id);
  if (!had) return;
  if (had.share?.id === share.id && had.share.mode === share.mode && had.share.hasPassword === share.hasPassword) return;
  writeApps(apps.map((a) => (a.id === id ? { ...a, share } : a)));
}
