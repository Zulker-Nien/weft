"use client";

// The "already signed in" banner above the form on /login. Mirrors
// `@aimhuge/auth/client`'s `SignedInPrompt` (avatar, name, Continue, Switch
// account). The package's signOutAndRedirect is a server action; on the desktop
// we wire the Switch button to a client-side `useAuth().signOut()` because the
// board's /api/account/signout is a JSON endpoint (lib/client.ts). On the
// deployed weft.zip (`deployed: true`) a plain POST form to /auth/sign-out
// does the same job without any JS.
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, LogOut } from "lucide-react";
import { useAuth } from "./hooks";
import type { SessionIdentity } from "./identity";

export function SignedInPrompt({ identity, next, deployed = false }: { identity: SessionIdentity; next: string; deployed?: boolean }) {
  const { busy, signOut } = useAuth({ defaultNext: next });
  const [switching, setSwitching] = useState(false);
  const { name, email, avatarUrl } = identity;
  const display = name ?? email ?? "Signed in";
  const initial = (name?.[0] ?? email?.[0] ?? "?").toUpperCase();

  return (
    <div className="wz-loginProfile">
      <div className="wz-loginProfileIdentity">
        <span aria-hidden="true" className="wz-loginAvatar">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = "none";
                const fallback = target.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "";
              }}
            />
          ) : null}
          <span style={{ display: avatarUrl ? "none" : "" }}>{initial}</span>
        </span>

        <div className="wz-loginProfileText">
          <p className="wz-loginProfileName">{display}</p>
          <p className="wz-loginProfileLabel">Already signed in</p>
        </div>
      </div>

      <div className="wz-loginProfileActions">
        <Link href={next} prefetch className="wz-loginContinue">
          Continue
          <ArrowRight className="wz-loginActionIcon" aria-hidden="true" />
        </Link>

        {deployed ? (
          // Plain POST form so the visitor's cookie session can be cleared by
          // the same-origin /auth/sign-out route without any JS.
          <form method="post" action="/auth/sign-out" onSubmit={() => setSwitching(true)}>
            <button type="submit" disabled={switching} className="wz-loginSwitch">
              {switching ? <Loader2 className="wz-loginActionIcon wz-loginSpinnerIcon" aria-label="Signing out" /> : <LogOut className="wz-loginActionIcon" aria-hidden="true" />}
              Switch account
            </button>
          </form>
        ) : (
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
            className="wz-loginSwitch"
          >
            {switching || busy === "signout" ? <Loader2 className="wz-loginActionIcon wz-loginSpinnerIcon" aria-label="Signing out" /> : <LogOut className="wz-loginActionIcon" aria-hidden="true" />}
            Switch account
          </button>
        )}
      </div>
    </div>
  );
}
