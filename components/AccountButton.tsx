"use client";

import { useAccount } from "@/lib/use-account";
import Avatar from "./Avatar";
import Icon, { Spinner } from "./Icon";

// The top bar's account control, right of Copilot. Signed out: "Sign in" with GitHub, which finishes in
// your browser. Signed in: just your avatar, which opens Settings, where Sign out lives. Hidden while
// loading, on errors, and in builds without a Supabase key, so it never costs header room for nothing.
export default function AccountButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { state, busy, waiting, error, signIn } = useAccount();
  if (state.kind !== "ready" || !state.view.configured) return null;

  const user = state.view.user;
  if (user) {
    const who = user.name ?? user.email ?? "your account";
    return (
      <button
        onClick={onOpenSettings}
        title={`Signed in as ${who}`}
        aria-label={`Signed in as ${who}`}
        className="rounded-full p-0.5 hover:bg-sunken"
      >
        <Avatar user={user} size={24} />
      </button>
    );
  }

  const pending = busy === "github" || waiting !== null;
  return (
    <button
      onClick={() => void signIn("github")}
      disabled={busy !== null}
      title={error ?? (waiting ? "Finish signing in with GitHub in your browser" : "Sign in with GitHub")}
      aria-label="Sign in with GitHub"
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] disabled:opacity-60 ${error ? "border-danger text-danger" : "border-line-strong text-ink hover:bg-sunken"}`}
    >
      {pending ? <Spinner size={13} /> : <Icon name="github" size={14} />}
      {waiting ? "Signing in…" : "Sign in"}
    </button>
  );
}
