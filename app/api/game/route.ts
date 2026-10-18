import { connection } from "next/server";
import { gameState } from "@/lib/game-server";
import { cachedGithubProfile, githubProfile } from "@/lib/github-profile";
import { fail, guard } from "@/lib/guard";
import { profileCard } from "@/lib/profile-card";
import { syncProfileCard } from "@/lib/profile-card-sync";

// Streaks, XP, achievements and the builder card (lib/game-server.ts). ?cwd= is the project in view;
// &full=1 (the dialog) measures your busiest projects for the code health and production-ready badges
// and reads your GitHub profile (lib/github-profile.ts); the light request uses the cached profile. The
// dialog also posts your public builder card (lib/profile-card-sync.ts) in the background, so weft.zip/@you
// catches up the moment you look at your own.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "1";
  try {
    const github = full ? await githubProfile() : cachedGithubProfile();
    const game = gameState({ cwd: url.searchParams.get("cwd"), full });
    if (full) void syncProfileCard({ card: () => Promise.resolve(profileCard(game, github)) }).catch(() => {});
    return Response.json({ game: { ...game, github } });
  } catch (err) {
    return fail(err, 500);
  }
}
