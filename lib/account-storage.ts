// supabase-js storage for the Weft account's session in the desktop app: Electron main keeps it sealed by
// safeStorage (electron/account-store.cjs) and this server reads and writes it over main's token-guarded control
// server. A copy stays in memory so supabase-js's frequent reads don't each make a trip. Outside the desktop
// app there's no main, and lib/account.ts falls back to its plain file.

type Session = Record<string, string>;

export function shellStorage(url: string, token: string, fetchFn: typeof fetch = fetch) {
  let cache: Promise<Session> | null = null;

  async function call(route: string, body: unknown) {
    const res = await fetchFn(`${url}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { data?: Session; error?: string };
    if (!res.ok) throw new Error(json.error ?? `The desktop app said ${res.status}.`);
    return json;
  }

  // A failed read isn't cached: the next one asks main again.
  function load() {
    cache ??= call("/account/read", {}).then(
      (r) => r.data ?? {},
      (err: unknown) => {
        cache = null;
        throw err;
      },
    );
    return cache;
  }

  async function save(change: (data: Session) => Session) {
    const data = change({ ...(await load()) });
    cache = Promise.resolve(data);
    await call("/account/write", { data });
  }

  return {
    async getItem(key: string): Promise<string | null> {
      return (await load())[key] ?? null;
    },
    setItem: (key: string, value: string) => save((data) => ({ ...data, [key]: value })),
    removeItem: (key: string) => save((data) => Object.fromEntries(Object.entries(data).filter(([k]) => k !== key))),
  };
}
