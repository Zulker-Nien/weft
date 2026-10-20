// Type shim for ./app-data.cjs so the test file (and any future TS importer) gets real types instead
// of `any`. The runtime module is unchanged; only TS uses these declarations. Uses `export =` so
// the .d.ts is treated as a module and the names are visible to `import { ... } from "./app-data.cjs"`.

export type VaultSecret = { name: string; environment: string; missing?: boolean };
export type VaultNames = { label: string; secrets: VaultSecret[] };
export type VaultValues = { label: string; values: Record<string, string>; missing: string[] };
export type Vault = {
  names(folder: string): Promise<VaultNames>;
  valuesFor(folder: string, names: string[], env: string): Promise<VaultValues>;
  confirm(reason: string): Promise<boolean>;
  // Adds names as blanks so the rail's count goes up; returns the label and the names that
  // already had values (electron/vault.cjs addBlanks). Optional so a fakes-only test that
  // never calls requestSecret can skip it.
  addBlanks?(folder: string, names: string[], environments: string[], opts?: { source?: string; hint?: string }): Promise<{ label: string; filled: string[] }>;
};
export type ReadEntry = { supabase?: string; args?: Record<string, unknown>; ga4?: Record<string, unknown> };
// One secret in the manifest. `from: "author"` (the default) is shipped with the app; `from:
// "viewer"` is provided by whoever runs the app. The hosts/methods/paths arrays are the policy
// gate for weft.fetch: the request is only sent when the host, method and path prefix match.
export type ManifestSecret = {
  from?: "author" | "viewer";
  hosts: string[];
  methods?: string[];
  paths?: string[];
};
export type Manifest = {
  name: string;
  folder: string;
  env: "development" | "preview" | "production";
  supabaseUrl: string | null;
  reads: Record<string, ReadEntry>;
  // Optional in older manifests (and in app-data.cjs's existing tests, which don't use fetch).
  secrets?: Record<string, ManifestSecret>;
  public?: string[];
};
export type Grant = { env: string; folder: string; needs: string[]; readsHash: string; grantedAt: string };
export type SavedApp = { id?: string; name?: string; url: string; addedAt?: number };
export type AccessState = {
  app: string;
  project: string;
  env: string;
  needs: string[];
  missing: string[];
  granted: boolean;
  saved: boolean;
};
// Electron's IpcMainInvokeEvent, as much of it as app-data reads: the sending WebContents (its mainFrame) and frame.
export type FrameEvent = {
  sender: { mainFrame?: { url?: string } | null } & Record<string, unknown>;
  senderFrame: { url?: string } | null;
};
export type AppData = {
  access(event: FrameEvent): Promise<AccessState>;
  requestAccess(event: FrameEvent): Promise<AccessState>;
  revoke(event: FrameEvent): Promise<AccessState>;
  read(event: FrameEvent, name: string, args: Record<string, unknown> | null | undefined): Promise<{ rows: unknown }>;
  resolve(event: FrameEvent): Promise<{ folder: string; manifest: Manifest; saved: SavedApp; grant: Grant | null }>;
};
export function createAppData(opts: {
  dataDir: string;
  vault: Vault;
  readLink: (folder: string) => Promise<{ ref: string } | null>;
  fetch?: (url: string, init?: unknown) => Promise<unknown>;
  now?: () => number;
}): AppData;
export function registerAppData(
  ipcMain: { handle: (channel: string, fn: (event: FrameEvent, ...args: unknown[]) => Promise<unknown>) => void },
  opts: { appData: AppData; owns: (sender: unknown) => boolean }
): void;
export function setupAppData(opts: {
  ipcMain: { handle: (channel: string, fn: (event: FrameEvent, ...args: unknown[]) => Promise<unknown>) => void };
  dataDir: string;
  vault: Vault;
  owns: (sender: unknown) => boolean;
  readLink?: (folder: string) => Promise<{ ref: string } | null>;
  fetch?: (url: string, init?: unknown) => Promise<unknown>;
}): AppData;
export function appFolderFromUrl(dataDir: string, frameUrl: string): { folder: string; manifestPath: string };
export function readManifest(manifestPath: string, folder: string): Manifest;
export function findSavedApp(dataDir: string, folder: string): SavedApp | undefined;
export function deriveNeeds(reads: Record<string, ReadEntry>): string[];
export function manifestHash(manifest: Manifest): string;
export function effectiveGrant(grant: Grant | null | undefined, manifest: Manifest, needs: string[]): Grant | null;
export function loadGrants(dataDir: string): Record<string, Grant>;
export function saveGrants(dataDir: string, grants: Record<string, Grant>, now?: () => number): void;
export function loadApps(dataDir: string): SavedApp[];
export function isInside(parent: string, child: string): boolean;
export function senderOk(owns: (sender: unknown) => boolean, event: FrameEvent): boolean;
export const APPS_DIR: string;
export const APPS_FILE: string;
export const GRANTS_FILE: string;
