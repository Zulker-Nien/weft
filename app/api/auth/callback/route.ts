// The /api/auth/callback landing point. Mirrors `@aimhuge/auth/server`'s
// `createAuthCallback` so the local seam is wire-compatible with the package.
// When the upstream tag lands, this file is replaced by:
//
//   export const GET = createAuthCallback({ defaultNext: "/app" });
//
// Today the body is the same: exchange the one-time `code` against the PKCE
// verifier kept in the file-based session (lib/account.ts:finishSignIn), then
// redirect to `next`. Failures land on `/login?error=link&reason=…` so the form
// can show a "the link expired" message.
import { createAuthCallback } from "@/lib/auth";

export const GET = createAuthCallback({ defaultNext: "/app" });
