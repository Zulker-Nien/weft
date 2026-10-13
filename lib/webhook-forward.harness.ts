// The fake Weft account (Supabase client with webhook_relays and webhook_deliveries, Realtime channel) the webhook
// forwarder's tests share (lib/webhook-forward.test.ts, lib/webhook-forward-listen.test.ts). A test file makes it with vi.hoisted and mocks ./account:
//   const fake = await vi.hoisted(async () => (await import("./webhook-forward.harness")).fakeAccount());

export type Row = Record<string, unknown>;

export function fakeAccount() {
  const state = {
    uid: "u1" as string | null,
    relays: [] as Row[],
    deliveries: [] as Row[],
    error: null as { message: string } | null,
    deleteError: null as { message: string } | null,
    nextRelay: 1,
    onChange: null as null | ((change: { new: { id?: unknown } }) => void),
    onStatus: null as null | ((status: string) => void),
    onAuth: null as null | (() => void),
    channels: [] as string[],
    removed: 0,
    throwClient: false,
    gte: [] as string[],
  };

  function from(table: string) {
    const rows = () => (table === "webhook_relays" ? state.relays : state.deliveries);
    let op = "select";
    let value: Row = {};
    let order = false;
    const where: [string, unknown][] = [];
    const matches = () => rows().filter((r) => where.every(([k, v]) => r[k] === v));
    const run = () => {
      if (op === "delete" && state.deleteError) return { data: null, error: state.deleteError };
      if (state.error) return { data: null, error: state.error };
      if (op === "insert") {
        const row = { id: `00000000-0000-4000-8000-${String(state.nextRelay++).padStart(12, "0")}`, ...value };
        state.relays.push(row);
        return { data: row, error: null };
      }
      if (op === "delete") {
        const gone = new Set(matches());
        if (table === "webhook_relays") state.relays = state.relays.filter((r) => !gone.has(r));
        else state.deliveries = state.deliveries.filter((r) => !gone.has(r));
        return { data: null, error: null };
      }
      const found = matches();
      return { data: order ? [...found].sort((a, b) => Number(a.id) - Number(b.id)) : found, error: null };
    };
    const q = {
      select: () => q,
      insert: (row: Row) => ((op = "insert"), (value = row), q),
      delete: () => ((op = "delete"), q),
      eq: (k: string, v: unknown) => (where.push([k, v]), q),
      gte: (_k: string, v: string) => (state.gte.push(v), q),
      order: () => ((order = true), q),
      maybeSingle: () => {
        const r = run();
        return Promise.resolve(r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null });
      },
      single: () => Promise.resolve(run()),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  }

  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: state.uid ? { user: { id: state.uid } } : null } }),
      onAuthStateChange: (cb: () => void) => {
        state.onAuth = cb;
      },
    },
    from,
    channel: (name: string) => {
      state.channels.push(name);
      const ch = {
        on: (_type: string, _filter: unknown, cb: (change: { new: { id?: unknown } }) => void) => ((state.onChange = cb), ch),
        subscribe: (cb?: (status: string) => void) => ((state.onStatus = cb ?? null), ch),
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
