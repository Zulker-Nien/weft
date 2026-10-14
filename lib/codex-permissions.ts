import type { PermissionMode } from "./types";

export function permissionArgs(mode: PermissionMode) {
  switch (mode) {
    case "bypassPermissions": return ["--sandbox", "danger-full-access", "--dangerously-bypass-approvals-and-sandbox"];
    case "auto": return ["--approve-for-me"];
    case "acceptEdits": return ["--sandbox", "workspace-write", "--config", 'approval_policy="never"'];
    default: return ["--sandbox", "read-only", "--config", 'approval_policy="never"'];
  }
}
