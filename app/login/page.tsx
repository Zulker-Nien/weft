// The /login page on the deployed weft.zip. Mirrors the package's recommended
// shape: <Suspense> + readSessionIdentity + SignedInPrompt + LoginForm, with
// safeNextPath on the `?next=` param. Today the form is a thin wrapper that
// renders one "Continue with GitHub" button; the magic-link row is opt-in.
//
// On the deployed site the form is a set of plain GET links to /auth/sign-in
// and the signed-in prompt is a POST form to /auth/sign-out — the cookie
// session is on the same origin, so a no-JS round trip is the whole job. The
// desktop / `next dev` flow keeps the JS-driven useAuth() path.
//
// Only rendered on the deployed site (Vercel / WEFT_HOME); in the desktop app
// the board's sign-in dialog is the way in, not this page.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm, SignedInPrompt, readSessionIdentity, safeNextPath } from "@/lib/auth";
import { isDeployed } from "@/lib/home";
import emblem from "@/electron/assets/emblem.png";
import "@/components/home/home.css";

const DEFAULT_NEXT = "/team";

export const metadata: Metadata = {
  title: "Sign in to Weft",
  description: "Sign in to Weft with GitHub to sync your boards and unlock cloud features.",
};

function Handles() {
  const corners = ["top-left", "top-right", "bottom-left", "bottom-right"];
  return (
    <>
      {corners.map((corner) => (
        <span key={corner} aria-hidden="true" className={`wz-loginHandle wz-loginHandle--${corner}`} />
      ))}
    </>
  );
}

function Shell({ children, description }: { children?: React.ReactNode; description: string }) {
  return (
    <div className="wz-root wz-login">
      <header className="wz-wrap wz-loginHeader">
        <Link href="/" className="wz-loginBrand">
          <Image src={emblem} alt="" width={26} height={26} className="wz-emblem" />
          Weft
        </Link>
        <Link href="/" className="wz-loginBack">Back to weft.zip</Link>
      </header>

      <main className="wz-loginMain">
        <div className="wz-loginFrame wz-rise">
          <span aria-hidden="true" className="wz-loginGuide wz-loginGuide--vertical" />
          <span aria-hidden="true" className="wz-loginGuide wz-loginGuide--horizontal" />
          <span aria-hidden="true" className="wz-loginCoordinate wz-loginCoordinate--x">x: 960</span>
          <span aria-hidden="true" className="wz-loginCoordinate wz-loginCoordinate--y">y: 540</span>

          <section className="wz-loginCard">
            <Handles />
            <p className="wz-loginEyebrow">Weft account</p>
            <h1 className="wz-loginTitle">Pick up the thread.</h1>
            <p className="wz-loginSubtitle">{description}</p>
            {children}
            <span className="wz-loginMeta wz-loginMeta--left">weft://login · account access</span>
            <span className="wz-loginMeta wz-loginMeta--right">weft.zip</span>
          </section>
        </div>
      </main>

      <footer className="wz-loginFooter">
        A board for your AI, synced wherever you pick up the thread.
      </footer>
    </div>
  );
}

async function LoginBody({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next }, identity] = await Promise.all([searchParams, readSessionIdentity()]);
  const safeNext = safeNextPath(next, DEFAULT_NEXT);
  return (
    <>
      {identity && <SignedInPrompt identity={identity} next={safeNext} deployed />}
      <LoginForm defaultNext={safeNext} providers={["github"]} deployed />
    </>
  );
}

function LoginBodyFallback() {
  return (
    <div className="wz-loginChecking">
      <span className="wz-loginSpinner" aria-hidden="true" />
      Checking your account
    </div>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // In plain `next dev` (no Vercel / WEFT_HOME) the page is a no-op marker.
  if (!isDeployed()) {
    return (
      <Shell description="In the desktop app, the board&apos;s sign-in button is how you sign in." />
    );
  }
  // searchParams is awaited inside <LoginBody>, which is a Server Component
  // wrapped in <Suspense>; we hand the promise straight through.
  return (
    <Shell description="A Weft account syncs your boards across machines, turns on share links, and lets the Puku trial run on Weft&apos;s key. Optional — the desktop app works signed out.">
      <Suspense fallback={<LoginBodyFallback />}>
        <LoginBody searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}
