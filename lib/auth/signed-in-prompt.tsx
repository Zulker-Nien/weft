"use client";

// The "already signed in" banner above the form on /login. Mirrors
// `@aimhuge/auth/client`'s `SignedInPrompt` (avatar, name, Continue, Switch
// account). The package's signOutAndRedirect is a server action; we wire the
// Switch button to a client-side `useAuth().signOut()` because the board's
// /api/account/signout is a JSON endpoint (lib/client.ts) and the form lives
// in a deployed-server context where a server action would do the same job.
import { useState } from "react";
import { useAuth } from "./hooks";
import type { SessionIdentity } from "./identity";

export function SignedInPrompt({ identity, next }: { identity: SessionIdentity; next: string }) {
  const { busy, signOut } = useAuth({ defaultNext: next });
  const [switching, setSwitching] = useState(false);
  const { name, email, avatarUrl } = identity;
  const display = name ?? email ?? "Signed in";
  const initial = (name?.[0] ?? email?.[0] ?? "?").toUpperCase();

  return (
    <div className="mb-5 flex items-center gap-3 rounded-md border border-line bg-card px-4 py-3.5">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-[14px] font-semibold text-accent"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={(e) => {
              const t = e.currentTarget;
              t.style.display = "none";
              const fb = t.nextElementSibling as HTMLElement | null;
              if (fb) fb.style.display = "";
            }}
          />
        ) : null}
        <span style={{ display: avatarUrl ? "none" : "" }}>{initial}</span>
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-ink">{display}</p>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Already signed in</p>
      </div>

      <div className="flex items-center gap-2">
        <a
          href={next}
          className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-semibold text-on-accent hover:opacity-90"
        >
          Continue
        </a>
        <button
          type="button"
          disabled={busy !== null || switching}
          onClick={() => {
            void (async () => {
              setSwitching(true);
              await signOut();
              setSwitching(false);
            })();
          }}
          className="rounded-md border border-line-strong px-3.5 py-2 text-[13px] font-semibold text-muted hover:text-ink disabled:opacity-50"
        >
          {switching || busy === "signout" ? "Signing out…" : "Switch"}
        </button>
      </div>
    </div>
  );
}
