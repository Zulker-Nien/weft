// One value per server process, kept on globalThis so dev-mode reloads don't make a second one.
// init runs only while the key is unset; deleting the key (as tests do) makes the next call build afresh.
export function globalSingleton<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as Record<string, T | undefined>;
  return (g[key] ??= init());
}
