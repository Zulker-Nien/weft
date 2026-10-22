// The "paste your provider token" form every rail drawer shows before it's linked (Vercel, Supabase).
// Same shape each time: an error, a line pointing at the provider's token page, a password field, Save
// and Forget. Only the provider's name, its token URL and the placeholder differ, so those are props —
// a new provider is one call, not another 50-line form. The two-step Cloudflare form (a setup token it
// exchanges for its own) and BlastCP's OAuth sign-in are different enough to keep their own.
"use client";
import { useState } from "react";

import { SMALL } from "./tone";

export interface TokenFormProps {
  // Shown above the field; null until a save fails.
  error: string | null;
  // A save is in flight — disables both buttons and swaps the primary's label.
  busy: boolean;
  onSave: (token: string) => Promise<void>;
  // Omitted when the drawer has nothing saved to forget.
  onForget?: () => void;
  // The provider's name, for the sentence and the field's accessible label ("Vercel token").
  provider: string;
  // Where the token comes from: the provider's own token page.
  tokenUrl: string;
  // The link's text, which is usually but not always the URL ("sbp_…" has none).
  linkText?: string;
  // The field's placeholder; defaults to "<provider> token".
  placeholder?: string;
  // The field's accessible label; defaults to "<provider> token". Supabase's reads "access token".
  label?: string;
  // The link's label. Defaults to "Save token", swapped for "Checking…" while busy.
  action?: string;
  busyAction?: string;
}

// The token never leaves this component's state; it's handed to onSave and cleared on success, so a
// failed save can be retried without the field being re-typed.
export function TokenForm({ error, busy, onSave, onForget, provider, tokenUrl, linkText, placeholder, label, action = "Save token", busyAction = "Checking…" }: TokenFormProps) {
  const [token, setToken] = useState("");
  return (
    <form
      className="flex flex-col gap-2 px-3 py-3 text-[11.5px] leading-snug text-muted"
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) void onSave(token).then(() => setToken(""));
      }}
    >
      {error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-danger">{error}</p>}
      <p>
        Link this project to {provider} with a token from{" "}
        <a
          href={tokenUrl}
          onClick={(e) => {
            e.preventDefault();
            window.weft?.openExternal(tokenUrl);
          }}
          className="text-accent underline"
        >
          {linkText ?? tokenUrl.replace(/^https?:\/\//, "")}
        </a>
        . Weft keeps it in your Keychain; threads never see it.
      </p>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder={placeholder ?? `${provider} token`}
        aria-label={label ?? `${provider} token`}
        autoComplete="off"
        className="rounded-md border border-line-strong bg-card px-2 py-1 text-[12px] text-ink"
      />
      <div className="flex gap-1.5">
        <button type="submit" disabled={busy || !token.trim()} className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40">
          {busy ? busyAction : action}
        </button>
        {onForget && (
          <button type="button" onClick={onForget} disabled={busy} className={SMALL}>
            Forget it
          </button>
        )}
      </div>
    </form>
  );
}