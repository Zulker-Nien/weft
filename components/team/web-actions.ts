"use client";

// Bridge between the team components (Roster / InviteForm / PendingInvites
// / LeaveButton) and lib/team-actions.ts. The team components take
// `actions: TeamClientActions` so the same code path serves weft.zip and
// the desktop's Settings → Team. The desktop goes through lib/use-team.ts
// (which posts to /api/account/team); weft.zip's server page passes an
// actions object built here, which closes over the org slug and calls the
// server actions directly. Server actions are async and the team page is
// a server component, so this file is marked "use client" and rendered
// inside the WebTeam client wrapper (app/[orgSlug]/team/page.tsx).

import type { TeamActionResult, TeamClientActions, TeamRole } from "@/lib/team-types";
import {
  changeMemberRole as serverChangeMemberRole,
  inviteMember as serverInviteMember,
  removeMember as serverRemoveMember,
  revokeInvite as serverRevokeInvite,
} from "@/lib/team-actions";

// Build a TeamClientActions for an org on weft.zip. Each function closes
// over the org slug; the page passes the result to its "use client"
// children.
export function webTeamActions(orgSlug: string): TeamClientActions {
  return {
    async invite(email: string, role: TeamRole): Promise<TeamActionResult> {
      // The server action in lib/team-actions.ts accepts the plain args
      // (agent S1 is moving it from FormData to these). The result is
      // already { ok, message? }.
      return serverInviteMember(orgSlug, email, role);
    },
    async changeRole(userId: string, role: TeamRole): Promise<TeamActionResult> {
      return serverChangeMemberRole(orgSlug, userId, role);
    },
    async remove(userId: string): Promise<TeamActionResult> {
      return serverRemoveMember(orgSlug, userId);
    },
    async revoke(inviteId: string): Promise<TeamActionResult> {
      return serverRevokeInvite(orgSlug, inviteId);
    },
  };
}
