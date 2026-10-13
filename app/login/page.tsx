// The /login page on the deployed weft.zip. Mirrors the package's recommended
// shape: <Suspense> + readSessionIdentity + SignedInPrompt + LoginForm, with
// safeNextPath on the `?next=` param. Today the form is a thin wrapper that
// renders one "Continue with GitHub" button; the magic-link row is opt-in.
//
// Only rendered on the deployed site (Vercel / WEFT_HOME); in the desktop app
// the board's sign-in dialog is the way in, not this page.
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm, SignedInPrompt, readSessionIdentity, safeNextPath } from "@/lib/auth";
import { isDeployed } from "@/lib/home";

export const metadata: Metadata = {
  title: "Sign in to Weft",
  description: "Sign in to Weft with GitHub to sync your boards and unlock cloud features.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="wz-root wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Sign in to Weft</h1>
        <p className="wz-authSub">
          A Weft account syncs your boards across machines, turns on share links, and lets the Puku trial run on
          Weft&apos;s key. Optional — the desktop app works signed out.
        </p>
        {children}
      </main>
    </div>
  );
}

async function LoginBody({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next }, identity] = await Promise.all([searchParams, readSessionIdentity()]);
  const safeNext = safeNextPath(next, "/app");
  return (
    <>
      {identity && <SignedInPrompt identity={identity} next={safeNext} />}
      <LoginForm defaultNext={safeNext} providers={["github"]} />
    </>
  );
}

function LoginBodyFallback() {
  return (
    <div className="flex items-center gap-2 py-2 text-[12.5px] text-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-hidden="true" />
      Checking your account
    </div>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // In plain `next dev` (no Vercel / WEFT_HOME) the page is a no-op marker.
  if (!isDeployed()) {
    return (
      <div className="wz-root wz-auth">
        <main className="wz-authCard">
          <h1 className="wz-authTitle">Sign in to Weft</h1>
          <p className="wz-authSub">In the desktop app, the board&apos;s sign-in button is how you sign in.</p>
        </main>
      </div>
    );
  }
  // searchParams is awaited inside <LoginBody>, which is a Server Component
  // wrapped in <Suspense>; we hand the promise straight through.
  return (
    <Shell>
      <Suspense fallback={<LoginBodyFallback />}>
        <LoginBody searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}
