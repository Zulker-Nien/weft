// The board's view of the server: the Electron shell (lib/client-bridge.ts), the JSON
// fetch client (lib/client-api.ts), and `mergeThread` for live updates (lib/client-thread.ts).
// Re-exported here so `./client` stays the single import path.

export * from "./client-bridge";
export * from "./client-api";
export * from "./client-thread";