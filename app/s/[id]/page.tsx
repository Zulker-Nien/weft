// The /s/[id] page on weft.zip — one shared card's thread, live (lib/share-types.ts, docs/architecture/sharing.md).
// A server component reads the share, runs the access gate, and either renders the SharedCard or
// the appropriate fallback (404, login redirect, denied, gate form, unconfigured).
//
// Like the /[orgSlug]/board page, this lives in a Suspense boundary for cacheComponents
// (next.config.ts): the gate's redirects need a dynamic context, and the server-side cookie
// read means we couldn't be a static route.
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ShareGateForm } from "@aimhuge/share/client";
import { isDeployed } from "@/lib/home";
import { shareAccess } from "@/lib/share-access";
import { buildShareLive } from "@/lib/share-live";
import { serviceClient } from "@/lib/web-session";
import { SharedCard } from "@/components/share-view/SharedCard";

// Static on purpose: under Cache Components a generateMetadata that reads the gate's cookie raises an error while the
// shell prerenders, and a card's title in the tab isn't worth it. The page itself is dynamic inside its <Suspense>.
export const metadata: Metadata = {
  title: "Shared thread · Weft",
  robots: { index: false, follow: false },
};

function NotDeployed() {
  return (
    <main className="wz-app">
      <div className="wz-authCard">
        <h1 className="wz-authTitle">Shared thread</h1>
        <p className="wz-authSub">Shared links live on weft.zip. In the desktop app, the card&apos;s share button is the way in.</p>
      </div>
    </main>
  );
}

function Denied() {
  return (
    <main className="wz-app">
      <div className="wz-authCard">
        <h1 className="wz-authTitle">This thread is private</h1>
        <p className="wz-authSub">This thread is private to its workspace. Sign in to weft.zip and ask the owner to add you.</p>
      </div>
    </main>
  );
}

function Unconfigured() {
  return (
    <main className="wz-app">
      <div className="wz-authCard">
        <h1 className="wz-authTitle">Sharing isn&apos;t set up</h1>
        <p className="wz-authSub">This Weft doesn&apos;t have its share key configured. Ask the operator to set SHARE_GATE_SECRET.</p>
      </div>
    </main>
  );
}

// params is runtime data too, so it's awaited here, inside the <Suspense>, not in Page: the shell prerenders.
async function PageBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await shareAccess(id);
  if (access.kind === "unconfigured") return <Unconfigured />;
  if (access.kind === "missing") notFound();
  if (access.kind === "login") redirect(`/login?next=${encodeURIComponent(`/s/${id}`)}`);
  if (access.kind === "denied") return <Denied />;
  if (access.kind === "gate") {
    return (
      <ShareGateForm
        title="Shared thread"
        mode={access.mode}
        unlockUrl={`/api/s/${id}/unlock`}
        noun="thread"
      />
    );
  }
  // access.kind === "ok": render the SharedCard with the initial ShareLive built server-side.
  const service = serviceClient();
  if (!service) return <Unconfigured />;
  const { share, card } = access.share;
  // shareAccess's "ok" branch already returned "missing" when the card row was gone, so card is
  // non-null here — but the type is the union, and a future refactor of shareAccess could change
  // that. A null guard keeps this branch from rendering an empty card.
  if (!card) notFound();
  const live = await buildShareLive({ service, orgId: share.org_id, cardId: share.card_id, card: card.card });
  return <SharedCard id={id} initial={live} />;
}

function PageFallback() {
  return <p className="wz-boardLoading">Loading the shared thread…</p>;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!isDeployed()) return <NotDeployed />;
  return (
    <Suspense fallback={<PageFallback />}>
      <PageBody params={params} />
    </Suspense>
  );
}
