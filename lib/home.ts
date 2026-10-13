import type { Metadata } from "next";

// The home page at weft.zip (components/home/Home.tsx), served by the deployed Weft on Vercel: app/page.tsx renders
// it instead of the board when isDeployed(), and app/home/page.tsx always does, so it can be seen on localhost.
// What the page says and links to lives here, where lib/home.test.ts can read it; the release feed lookup that
// fills the download button is lib/home-release.ts.

export const SITE = "https://weft.zip";
export const REPO = "https://github.com/aimhuge/weft";
export const RELEASES = `${REPO}/releases`;
export const FEED = `${RELEASES}/latest/download/update.json`;
// The footer's credits, as on the board's footer (components/BoardFooter.tsx).
export const COFFEE = "https://buymeacoffee.com/alexmiller";
export const AIMHUGE = "https://aimhuge.com";
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

// The home page component's props (lib/home.ts has no opinions; the call site decides). `unknown` keeps the helper
// generic without us pretending the home is parametric.
type HomeComponent = (props: unknown) => unknown;

// The shape `loadHome` returns when the import fails — what the route's fallback renders and what the build error
// bar shows. Kept tiny on purpose: one message, one optional file (parsed out of Next's "X:Y" hint when we have it).
export interface HomeLoadError {
  message: string;
  file: string | null;
}

// The result of one load attempt: the component on success, an error on failure. Routes decide what to render.
export type HomeLoadResult = { Home: HomeComponent } | { error: HomeLoadError };

// Lazy-loads @/components/home/Home so a parse error in it (a stray `}`, an unresolved sub-import) cannot 500 the
// route that imports this helper. Cached after the first successful load so re-renders don't re-import; the cache
// resets on each cold start of the dev server, which is exactly when Fast Refresh would clear its own module cache
// anyway. The optional `importer` is for tests; production callers can ignore it.
//
// This is the parse-error companion to lib/route-import-guard.ts: that one refuses the *edit* that would add an
// unresolved import; this one narrows the runtime blast radius when the file does exist but won't parse. See
// docs/bug-fixes/010-...md and 011-...md.
let cached: HomeComponent | null = null;
export async function loadHome(importer: () => Promise<{ default: HomeComponent }> = defaultImporter): Promise<HomeLoadResult> {
  if (cached) return { Home: cached };
  try {
    const mod = await importer();
    if (typeof mod.default !== "function") {
      return { error: { message: "components/home/Home has no default export", file: null } };
    }
    cached = mod.default;
    return { Home: cached };
  } catch (err) {
    // Next's dev overlay says "Unexpected token. Did you mean `{'}'}` or `&rbrace;`?" with no file; the file is in
    // the import trace just above. We surface a short, file-bearing message the fallback can show alongside the
    // build error bar.
    const raw = err instanceof Error ? err.message : String(err);
    const file = raw.match(/\.\/([^\s()]+\.[a-z]+)/)?.[1] ?? null;
    return { error: { message: raw.split("\n")[0] || "Failed to load components/home/Home", file } };
  }
}

async function defaultImporter(): Promise<{ default: HomeComponent }> {
  // The `@/` alias is resolved by Next at build time; the import is dynamic so a parse error in the target only
  // surfaces when this runs, not when app/page.tsx loads.
  const mod = await import("@/components/home/Home");
  return mod;
}

// Test-only: clear the in-process cache so the next loadHome() call re-imports. The cache is module-scoped so
// tests in the same file would otherwise see the first call's result forever.
export function _resetLoadHomeCacheForTests(): void {
  cached = null;
}
