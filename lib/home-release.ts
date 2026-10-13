import { cacheLife } from "next/cache";
import { FEED, parseFeed, type Release } from "./home";

// The newest Weft release for the home page's download button, from the update feed the release workflow
// publishes with each tag (scripts/release-feed.mjs, docs/architecture/updates.md). Cached for hours, so a visit
// doesn't wait on GitHub and a new release shows within the hour; null when there is no release yet or GitHub
// can't be reached, and the button points at the repo instead (downloadLink in lib/home.ts).
export async function latestRelease(fetchFn: typeof fetch = fetch): Promise<Release | null> {
  "use cache";
  cacheLife("hours");
  try {
    const res = await fetchFn(FEED, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return parseFeed(await res.json());
  } catch {
    return null;
  }
}
