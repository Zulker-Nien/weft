// The share gate (lib/share-types.ts): one createShareGate from @aimhuge/share/server, with a cookie name
// prefix that can't collide with the rest of weft.zip's cookies and a secret that defaults to a dev
// constant in development. The same kit is used by the unlock route (mint a pass after a gate) and
// the live / page routes (check a pass on every request).
//
// A missing SHARE_GATE_SECRET in production refuses to mint OR verify a pass, so a misconfigured
// deployment can't be fooled by a forged cookie. The dev constant is only used when NODE_ENV is not
// "production" — `isProduction` is the single branch a test has to cover.
//
// `nameSecret` always returns something (it's a cookie-NAMES device, not a security boundary) so a
// visitor isn't asked again when the signing key rotates but the namespacing one doesn't.
import "server-only";
import { createShareGate, type ShareGateKit } from "@aimhuge/share/server";

const COOKIE_PREFIX = "weft_share_";
const DEV_SECRET = "weft-dev-share-gate";
const ENV_KEY = "SHARE_GATE_SECRET";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function readSecret(): string | null {
  const fromEnv = process.env[ENV_KEY];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return isProduction() ? null : DEV_SECRET;
}

function readNameSecret(): string {
  return process.env[ENV_KEY] || DEV_SECRET;
}

let cached: { key: string; kit: ShareGateKit } | null = null;

// Build the gate. The secret is read from the env; `nameSecret` always returns a value so the cookie
// name stays stable. Cached by the env value so a request that reads the secret first and a later one
// get the same kit (rotating the secret invalidates every pass, which is the intended behaviour).
export function getShareGate(): ShareGateKit {
  const envValue = process.env[ENV_KEY] || "";
  if (cached?.key === envValue) return cached.kit;
  const kit = createShareGate({
    cookiePrefix: COOKIE_PREFIX,
    secret: () => readSecret(),
    nameSecret: () => readNameSecret(),
  });
  cached = { key: envValue, kit };
  return kit;
}

// Exposed for tests so the cache can be reset between cases (and the env-rotation test starts fresh).
export function _resetShareGateCache(): void {
  cached = null;
}
