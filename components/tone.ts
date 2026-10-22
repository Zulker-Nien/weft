// The status palette and the two shared class strings the rail drawers and their parts use. The
// provider drawers (Vercel, Supabase, Cloudflare) each carried their own byte-identical copies; a
// palette change is one edit here now, and a new drawer imports instead of pasting. `TONE` keys match
// lib/db-picker.ts's Tone, which is what the view modules' STATES maps are typed against.

// A row's state as a badge: ok (green), warn (amber), bad (red), muted (neutral).
export const TONE = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-danger-soft text-danger", muted: "bg-sunken text-muted" } as const;

// A quiet secondary button — "Forget it", "Unlink" — beside a primary action.
export const SMALL = "rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";

// The small filled primary button a folder row's own action wears — "Link…", "Link CLI…".
export const LINK = "rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-40";

// A drawer's padded column of body copy.
export const BODY = "flex flex-col gap-2 px-3 py-3 text-[11.5px] leading-snug text-muted";