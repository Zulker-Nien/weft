// Test helpers for app-data: the data dir, the saved app, the fake vault and readLink. Kept in
// its own file so app-data.test.ts can stay under 300 lines. The .cjs modules are referenced
// through the ambient declarations; this file just stitches the fixtures.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import {
  createAppData,
  type FrameEvent,
  type Manifest,
  type SavedApp,
  type Vault,
} from "./app-data.cjs";

// A temp data dir with apps/ created; a fake vault; a fake readLink that points /projects/x at
// the test supabase ref. Shared across the describe blocks.
export function makeDataDir(): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-data-"));
  fs.mkdirSync(path.join(dataDir, "apps"), { recursive: true });
  return dataDir;
}

export const readLink = vi.fn((folder: string) => Promise.resolve(folder === "/projects/x" ? { ref: "lqjyravglujyizyqypxq" } : null));

export function makeVault({ label = "you/repo", secrets = [], values = {}, confirm = true }: { label?: string; secrets?: { name: string; environment: string; missing?: boolean }[]; values?: Record<string, string>; confirm?: boolean } = {}): Vault {
  return {
    names: () => Promise.resolve({ label, secrets }),
    valuesFor: (_folder: string, names: string[]) => {
      const present = new Set(names.filter((n) => values[n] !== undefined));
      return Promise.resolve({ label, values: Object.fromEntries([...present].map((n) => [n, values[n] as string])), missing: names.filter((n) => !present.has(n)) });
    },
    confirm: () => Promise.resolve(confirm),
  };
}

// A mini-app folder under dataDir/apps/<slug>/ with index.html and weft-app.json; saves a stub
// apps.json by default so the folder is a "saved app" the first time.
export function makeApp(dataDir: string, slug: string, manifest: Manifest, opts: { saved?: boolean } = {}): { folder: string; url: string } {
  const folder = path.join(dataDir, "apps", slug);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "index.html"), "<!doctype html><title>app</title>");
  fs.writeFileSync(path.join(folder, "weft-app.json"), JSON.stringify(manifest));
  const url = `file://${folder}/index.html`;
  if (opts.saved !== false) {
    const apps: SavedApp = { id: "saved-1", name: "📈 Growth", url, addedAt: Date.now() };
    fs.writeFileSync(path.join(dataDir, "apps.json"), JSON.stringify({ apps: [apps] }));
  }
  return { folder: fs.realpathSync(folder), url };
}

// Writes a JSON file under dataDir (objects are JSON.stringified) so a readManifest test can
// hand the path straight back to readManifest.
export function writeManifestFixture(dataDir: string, name: string, json: object | string): string {
  const d = path.join(dataDir, name);
  fs.writeFileSync(d, typeof json === "string" ? json : JSON.stringify(json));
  return d;
}

export const SAMPLE_MANIFEST: Manifest = {
  name: "📈 Growth",
  folder: "/projects/x",
  env: "production",
  supabaseUrl: "https://lqjyravglujyizyqypxq.supabase.co",
  reads: { overview: { supabase: "growth_overview" }, signups: { supabase: "growth_signups_by_day", args: { days: 30 } } },
};

// The shape our reads call fetch with: (url, init) → response-like. Tests pass this fake.
export type FetchInit = { method: string; headers: Record<string, string>; body?: string };
export type FetchLike = (url: string, init: FetchInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export function makeAppData({ dataDir, vault, readLink: rl = readLink, fetch: fetchImpl }: { dataDir: string; vault?: Vault; readLink?: typeof readLink; fetch?: FetchLike }) {
  // The module takes any fetch-shaped function; the tests' fake narrows init to what the reads send.
  return createAppData({ dataDir, vault: vault ?? makeVault(), readLink: rl, fetch: fetchImpl as ((url: string, init?: unknown) => Promise<unknown>) | undefined });
}

export function frameEvent({ url, owns = true, iframe = false }: { url: string; owns?: boolean; iframe?: boolean }): FrameEvent {
  const mainFrame = { url };
  return {
    sender: owns ? { id: "wc", mainFrame } : { id: "other", mainFrame },
    senderFrame: iframe ? { url } : mainFrame,
  };
}
