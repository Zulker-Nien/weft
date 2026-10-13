// The member-mutating behavior tests moved to lib/team-ops.test.ts when
// runInvite / runChangeRole / runRemove / runRevokeInvite were extracted
// from the server actions into lib/team-ops.ts. The server actions are
// now thin wrappers (gate → runTeamOp → revalidatePath) covered in
// lib/team-actions.test.ts. This file stays so the original `*-members`
// path is unambiguous in git history; new tests go in lib/team-ops.test.ts.
import { describe, it } from "vitest";

describe("placeholder", () => {
  it("exists so vitest doesn't think the file is missing tests", () => {});
});