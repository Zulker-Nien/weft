// Read a display identity off a Supabase user. Mirrors `@aimhuge/auth`'s
// `identityFromUser` so the local seam has the same shape.
//
// GitHub lands `user_name`, `avatar_url`, and (when the user gave GitHub a name)
// `full_name` in `user_metadata`. Older records and the email magic-link path
// use `name` / `avatar_url` / `email`. All shapes are accepted; the first
// non-empty value wins.
import type { User } from "@supabase/supabase-js";

export type SessionIdentity = {
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

export function identityFromUser(user: User): SessionIdentity {
  // `user.user_metadata` is required on the User type (just not always populated),
  // so we can pass it straight to a Record.
  const meta = user.user_metadata as Record<string, unknown>;
  return {
    name: text(meta.full_name) ?? text(meta.name) ?? text(meta.user_name),
    avatarUrl: text(meta.avatar_url) ?? text(meta.picture),
    // Supabase's User type is `email?: string | null`; we widen the union with
    // an explicit null fallback so the field is always present on the view.
    email: user.email ?? null,
  };
}
