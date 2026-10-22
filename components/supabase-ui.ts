// What the Supabase drawer, its picker and the New project form share. SMALL now lives in
// components/tone.ts with the rest of the shared palette; re-exported so these importers are unchanged.
export { SMALL } from "./tone";
export const external = (url: string) => window.weft?.openExternal(url);
