// The fake Weft account (Supabase client, Realtime channel) and temp Vercel links the Vercel hooks tests share
// (lib/vercel-hooks.test.ts, lib/vercel-hooks-listen.test.ts). A test file makes the state with vi.hoisted and mocks ./account:
//   const fake = await vi.hoisted(async () => (await import("./vercel-hooks.harness")).fakeAccount());
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Row = { id: string; team_id: string; vercel_hook_id: string; secret?: string };

export function fakeAccount() {
  const state = {
    uid: "u1" as string | null,
    uids: [] as (string | null)[],
    rows: [] as Row[],
    error: null as { message: string } | null,
    insertError: null as { message: string } | null,
    channels: [] as string[],
    removed: 0,
    onChange: null as null | ((change: { new: { project_id?: unknown } }) => void),
    onAuth: null as null | (() => void),
    throwClient: false,
  };

  function from(table: string) {
    if (table !== "vercel_hooks") throw new Error(table);
    let op = "select";
    let value: Partial<Row> = {};
    const where: [keyof Row, unknown][] = [];
    const matches = () => state.rows.filter((r) => where.every(([k, v]) => r[k] === v));
    const run = () => {
      if (op === "insert") {
        if (state.insertError) return { data: null, error: state.insertError };
        state.rows.push(value as Row);
        return { data: null, error: null };
      }
      if (state.error) return { data: null, error: state.error };
      if (op === "delete") {
        const gone = new Set(matches());
        state.rows = state.rows.filter((r) => !gone.has(r));
        return { data: null, error: null };
      }
      return { data: matches(), error: null };
    };
    const q = {
      select: () => q,
      insert: (row: Partial<Row>) => ((op = "insert"), (value = row), q),
      delete: () => ((op = "delete"), q),
      eq: (k: keyof Row, v: unknown) => (where.push([k, v]), q),
      maybeSingle: () => {
        const r = run();
        return Promise.resolve(r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null });
      },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  }

  const client = {
    auth: {
      getSession: () => {
        const uid = state.uids.length ? (state.uids.shift() ?? null) : state.uid;
        return Promise.resolve({ data: { session: uid ? { user: { id: uid } } : null } });
      },
      onAuthStateChange: (cb: () => void) => {
        state.onAuth = cb;
      },
    },
    from,
    channel: (name: string) => {
      state.channels.push(name);
      const ch = {
        on: (_type: string, _filter: unknown, cb: (change: { new: { project_id?: unknown } }) => void) => ((state.onChange = cb), ch),
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => {
      state.removed++;
      return Promise.resolve();
    },
  };
  return { state, client };
}

export type Fake = ReturnType<typeof fakeAccount>;

export const mainOk = (route: string): Promise<Record<string, unknown>> =>
  Promise.resolve(route === "/vercel/webhook-create" ? { id: "hook_1", secret: "whsec" } : {});

export function resetFake(fake: Fake) {
  Object.assign(fake.state, { uid: "u1", uids: [], rows: [], error: null, insertError: null, channels: [], removed: 0, onChange: null, onAuth: null, throwClient: false });
}

// Temp folders with .vercel/project.json links (or none).
export function linkedFolders(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const folder = (name: string, link?: unknown): string => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, ".vercel"), { recursive: true });
    if (link !== undefined) fs.writeFileSync(path.join(dir, ".vercel", "project.json"), typeof link === "string" ? link : JSON.stringify(link));
    return dir;
  };
  return { root, folder, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}
