// The shapes Weft's team UI works with, shared by weft.zip (lib/teams.ts, lib/team-ops.ts, app/api/teams), the desktop's
// forwarder (app/api/account/team) and the board (lib/use-team.ts, components/TeamSettings.tsx). Plain types only:
// the board imports this file, so nothing here may pull in server code or @aimhuge/teams.

export type TeamRole = "owner" | "admin" | "member";

export type TeamOrg = { id: string; slug: string; name: string };

export type TeamUser = { id: string; email: string | null; name: string | null; avatar: string | null };

export type TeamMember = {
  userId: string;
  email: string | null;
  name: string | null;
  role: TeamRole;
  joinedAt: string;
};

export type TeamInvite = { id: string; email: string; role: TeamRole; createdAt: string; expiresAt: string };

// A role the viewer may hand out, with the words the invite form shows for it.
export type RoleOption = { role: TeamRole; label: string; description: string };

// Everything a team page shows for one workspace, from the viewer's side. `pending` is empty unless canManage.
export type TeamSnapshot = {
  user: TeamUser;
  org: TeamOrg;
  role: TeamRole;
  orgs: TeamOrg[];
  canManage: boolean;
  members: TeamMember[];
  pending: TeamInvite[];
  roleOptions: RoleOption[];
  roleLabels: Record<TeamRole, string>;
};

// One change to a workspace: the body of POST /api/teams (weft.zip) and POST /api/account/team (desktop).
export type TeamOp =
  | { org: string; action: "invite"; email: string; role: TeamRole }
  | { org: string; action: "role"; userId: string; role: TeamRole }
  | { org: string; action: "remove"; userId: string }
  | { org: string; action: "revoke"; inviteId: string };

export type TeamActionResult = { ok: boolean; message?: string };

// What the team components call. On weft.zip these are server actions (components/team/web-actions.ts); in the
// desktop's Settings they post through the board's forwarder (lib/use-team.ts).
export type TeamClientActions = {
  invite: (email: string, role: TeamRole) => Promise<TeamActionResult>;
  changeRole: (userId: string, role: TeamRole) => Promise<TeamActionResult>;
  remove: (userId: string) => Promise<TeamActionResult>;
  revoke: (inviteId: string) => Promise<TeamActionResult>;
};

export const TEAM_ROLES: readonly TeamRole[] = ["owner", "admin", "member"];

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value);
}
