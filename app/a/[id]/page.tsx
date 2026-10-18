// The /a/[id] page on weft.zip — one shared mini app (lib/app-share-types.ts, docs/architecture/mini-apps.md).
// A server component reads the share, runs the same gate as a card's link (lib/app-share-access.ts), and renders the
// app's page full-window or the fallback (404, sign in, private, the gate form, not set up).
//
// Like /s/[id], it lives in a <Suspense> for cacheComponents: the gate reads the cookie, and params is runtime data.
import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ShareGateForm } from "@aimhuge/share/client";
import { appShareAccess } from "@/lib/app-share-access";
import { appFrameSrc } from "@/lib/app-share-types";
import { isDeployed } from "@/lib/home";
import { SharedApp } from "@/components/share-view/SharedApp";
import { ShareNotice } from "@/components/share-view/ShareNotice";
import "@/components/home/home.css";

// Static on purpose, like /s/[id]: a generateMetadata that reads the gate's cookie breaks the prerendered shell.
export const metadata: Metadata = {
  title: "Shared app · Weft",
  robots: { index: false, follow: false },
};

async function PageBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await appShareAccess(id);
  if (access.kind === "missing") notFound();
  if (access.kind === "login") redirect(`/login?next=${encodeURIComponent(`/a/${id}`)}`);
  if (access.kind === "unconfigured") {
    return <ShareNotice title="Sharing isn't set up">This Weft doesn&apos;t have its share key configured. Ask the operator to set SHARE_GATE_SECRET.</ShareNotice>;
  }
  if (access.kind === "denied") {
    return <ShareNotice title="This app is private">This app is shared with its workspace only. Sign in to weft.zip and ask the owner to add you.</ShareNotice>;
  }
  if (access.kind === "gate") return <ShareGateForm title="Shared app" mode={access.mode} unlockUrl={`/api/a/${id}/unlock`} noun="app" />;
  return <SharedApp name={access.share.name} src={appFrameSrc(id, access.share)} site={access.share.kind === "site"} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!isDeployed()) {
    return <ShareNotice title="Shared app">Shared apps live on weft.zip. In the desktop app, Share… on the app&apos;s tile is the way in.</ShareNotice>;
  }
  return (
    <Suspense fallback={<p className="wz-boardLoading">Loading the shared app…</p>}>
      <PageBody params={params} />
    </Suspense>
  );
}
