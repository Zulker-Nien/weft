import type { Metadata } from "next";

// The home page at weft.zip (components/home/Home.tsx), served by the deployed Weft on Vercel: app/page.tsx renders
// it instead of the board when isDeployed(), and app/home/page.tsx always does, so it can be seen on localhost.
// What the page says and links to lives here, where lib/home.test.ts can read it; the release feed lookup that
// fills the download button is lib/home-release.ts.

export const SITE = "https://weft.zip";
export const REPO = "https://github.com/aimhuge/weft";
export const RELEASES = `${REPO}/releases`;
export const FEED = `${RELEASES}/latest/download/update.json`;
export const TAGLINE = "A board for your AI";
export const DESCRIPTION =
  "Weft is a Mac kanban board where every card is a Claude Code thread, with a browser pane beside it. " +
  "You bring the idea; it runs the threads that plan it, build it, show it and walk you through the review.";

// Vercel sets VERCEL=1 on every deployment; WEFT_HOME=1 shows the home page at / on a local server too.
export function isDeployed(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL || env.WEFT_HOME);
}

export function homeMetadata(version: string): Metadata {
  const title = `Weft: ${TAGLINE}`;
  return {
    title,
    description: DESCRIPTION,
    metadataBase: new URL(SITE),
    alternates: { canonical: "/" },
    openGraph: { title, description: DESCRIPTION, url: SITE, siteName: "Weft", type: "website" },
    twitter: { card: "summary_large_image", title, description: DESCRIPTION },
    other: { "weft:version": version },
  };
}

// A release in scripts/release-feed.mjs's update.json, as the download button wants it.
export interface Release {
  version: string;
  dmg: string;
  page: string;
}

// Reads the feed's newest release; null when the feed has none or isn't the shape we write.
export function parseFeed(feed: unknown): Release | null {
  if (!feed || typeof feed !== "object") return null;
  const releases = (feed as { releases?: unknown }).releases;
  if (!Array.isArray(releases)) return null;
  for (const entry of releases) {
    if (!entry || typeof entry !== "object") continue;
    const { version, page, dmg } = entry as Record<string, unknown>;
    const url = typeof dmg === "string" ? dmg : typeof page === "string" ? page : undefined;
    if (typeof version === "string" && url) return { version, dmg: url, page: typeof page === "string" ? page : url };
  }
  return null;
}

// What the download button says and where it goes: the dmg when a release exists, the repo until then.
export function downloadLink(release: Release | null): { label: string; href: string; note: string } {
  if (release) {
    return {
      label: `Download Weft ${release.version} for Mac`,
      href: release.dmg,
      note: "Apple silicon. Signed and notarized; updates itself from GitHub Releases.",
    };
  }
  return {
    label: "Get Weft on GitHub",
    href: REPO,
    note: "The first release is on its way. Until then, clone it and run npm run desktop.",
  };
}
