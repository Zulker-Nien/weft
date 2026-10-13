// Fixtures and small helpers the lib/team-actions.ts server-action tests
// share. The actual service-client chainable from() lives in
// lib/team-ops.harness.ts (team-ops is where the data work happens now);
// the actions in lib/team-actions.ts are thin wrappers that delegate to
// runTeamOp after the gate runs.
export { USER, ORG, actorAtLeast, makeService } from "./team-ops.harness";
