"use client";

import { useCallback, useEffect, useState } from "react";
import { ACCOUNT_EVENT } from "./auth/hooks";
import type { TeamActionResult, TeamClientActions, TeamOp, TeamSnapshot } from "./team-types";

// The board's view of one workspace on the deployed weft.zip (docs/architecture/teams.md). The desktop's
// local Next server is the only thing that holds the desktop user's access token, so this hook talks to
// /api/account/team, which forwards the call. weft.zip's /api/teams validates the body, so the hook
// doesn't — the action just sends the op with the loaded team's org slug and trusts the answer.

export type TeamHookState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ok"; team: TeamSnapshot };

export type TeamHook = {
  state: TeamHookState;
  refresh: () => void;
  actions: TeamClientActions;
};

// The headers the local route needs; x-threadboard is what lib/guard.ts checks on writes.
const WRITE_HEADERS = { "content-type": "application/json", "x-threadboard": "1" };

// We can't read the status from the typed `api` client (it throws on non-2xx), so the hook asks the
// server directly and maps the status to a state. The forwarder has already turned a fetch error into
// a 502 { error: "offline" } reply, so a 502 here is "we couldn't reach weft.zip".
async function fetchTeam(org: string | undefined): Promise<{ state: Exclude<TeamHookState, { kind: "loading" }> }> {
  const query = org ? `?org=${encodeURIComponent(org)}` : "";
  let res: Response;
  try {
    res = await fetch(`/api/account/team${query}`, { method: "GET" });
  } catch {
    return { state: { kind: "error", message: "Couldn't reach weft.zip." } };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: unknown } & Partial<TeamSnapshot>;
  if (res.status === 401) return { state: { kind: "signed-out" } };
  if (res.status === 404) return { state: { kind: "error", message: "No workspace found." } };
  if (res.status === 502) return { state: { kind: "error", message: "Couldn't reach weft.zip." } };
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : `Weft's team API answered ${res.status}.`;
    return { state: { kind: "error", message } };
  }
  // The 2xx path: weft.zip's /api/teams is the only producer of TeamSnapshot the board reads, so a
  // structurally wrong reply is the deployer's problem; we still try to render what we got.
  return { state: { kind: "ok", team: body as TeamSnapshot } };
}

// One action: POST a TeamOp with the loaded org's slug, then refresh. Called from the team UI, so a
// failure with a clear message is what the form shows. A 401 inside an action means the user signed
// out between the load and the click; we return an error so the form can say so.
async function postOp(op: TeamOp): Promise<TeamActionResult> {
  let res: Response;
  try {
    res = await fetch("/api/account/team", { method: "POST", headers: WRITE_HEADERS, body: JSON.stringify(op) });
  } catch {
    return { ok: false, message: "Couldn't reach weft.zip." };
  }
  const body = (await res.json().catch(() => ({}))) as TeamActionResult & { error?: unknown };
  if (res.status === 401) return { ok: false, message: "Signed out." };
  if (res.status === 502) return { ok: false, message: "Couldn't reach weft.zip." };
  if (res.status === 404) return { ok: false, message: "No workspace found." };
  if (!res.ok) {
    return { ok: false, message: typeof body.error === "string" ? body.error : `Team API answered ${res.status}.` };
  }
  // The 2xx body is what weft.zip's POST handler returns; truthy `ok` is the success branch and the
  // action shapes the form's result off it. A payload without `ok` is treated as failure so a broken
  // deployment can't masquerade as success.
  return { ok: body.ok, message: typeof body.message === "string" ? body.message : undefined };
}

export function useTeam(org?: string): TeamHook {
  // Bumping this counter tells the load effect to fetch again. The refresh callback and the
  // post-op refresh also bump it.
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  // Each load is keyed by (org, reload). A result only counts for the key it was fetched for, so when the org
  // changes or a refresh starts, the state reads "loading" straight away and stale data never shows.
  const key = `${org ?? ""}#${reload}`;
  const [loaded, setLoaded] = useState<{ key: string; state: TeamHookState } | null>(null);
  const state: TeamHookState = loaded?.key === key ? loaded.state : { kind: "loading" };

  useEffect(() => {
    let alive = true;
    void fetchTeam(org).then((next) => {
      if (alive) setLoaded({ key, state: next.state });
    });
    return () => {
      alive = false;
    };
  }, [org, key]);

  // The board fires `weft:account` whenever the user signs in or out (lib/auth/hooks.ts). Signing out
  // means the snapshot is no longer ours; signing in means we may now have a fresh one. Either way a
  // reload is the right answer.
  useEffect(() => {
    window.addEventListener(ACCOUNT_EVENT, refresh);
    return () => window.removeEventListener(ACCOUNT_EVENT, refresh);
  }, [refresh]);

  // An action that needs a loaded team but doesn't have one still returns a TeamActionResult; the
  // form just shows the message. The UI hides the buttons in those states anyway, but the type
  // stays a single TeamClientActions shape so the components don't have to branch.
  const noTeamMessage: TeamActionResult = { ok: false, message: "Load a workspace first." };
  // Same body as `refresh`; kept under another name so the action handlers read like actions.
  const trigger = refresh;

  const actions: TeamClientActions = {
    invite: (email, role) => {
      if (state.kind !== "ok") return Promise.resolve(noTeamMessage);
      return postOp({ org: state.team.org.slug, action: "invite", email, role }).then((r) => {
        if (r.ok) trigger();
        return r;
      });
    },
    changeRole: (userId, role) => {
      if (state.kind !== "ok") return Promise.resolve(noTeamMessage);
      return postOp({ org: state.team.org.slug, action: "role", userId, role }).then((r) => {
        if (r.ok) trigger();
        return r;
      });
    },
    remove: (userId) => {
      if (state.kind !== "ok") return Promise.resolve(noTeamMessage);
      return postOp({ org: state.team.org.slug, action: "remove", userId }).then((r) => {
        if (r.ok) trigger();
        return r;
      });
    },
    revoke: (inviteId) => {
      if (state.kind !== "ok") return Promise.resolve(noTeamMessage);
      return postOp({ org: state.team.org.slug, action: "revoke", inviteId }).then((r) => {
        if (r.ok) trigger();
        return r;
      });
    },
  };

  return { state, refresh, actions };
}
