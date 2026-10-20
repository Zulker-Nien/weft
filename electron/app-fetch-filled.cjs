// Splits out of app-fetch-policy.cjs so the policy module stays under the 300-line cap:
// the filled-URL re-check (verifyFilledUrl) calls ruleAllowsSecret on the policy module and
// pathHasEscapes from the helpers. Pure, dependency-free, and shared between Electron main
// and the weft.zip route through app-fetch-run.cjs.

const { pathHasEscapes } = require("./app-fetch-policy-helpers.cjs");

// Lazy require to avoid a circular load: app-fetch-policy.cjs -> app-fetch-parse-secret.cjs
// doesn't loop back here, so we resolve the policy module on the first call and cache it.
let _policyMod = null;
function policyMod() {
  if (_policyMod) return _policyMod;
  _policyMod = require("./app-fetch-policy.cjs");
  return _policyMod;
}

// Parses the planned URL string from planFetch into a URL object. planFetch has already
// validated that string with the WHATWG parser, so a parse error here is a 400, never a
// runtime mystery.
function parsePlannedUrl(plan) {
  try {
    return { ok: true, parsed: new URL(plan.url) };
  } catch {
    return { ok: false, status: 400, error: "planned url isn't parseable." };
  }
}

// Parses the filled request's URL. fillSecrets returns the request with placeholders
// replaced, so the URL parser tells us the actual path and query the server will see.
function parseFilledUrl(request) {
  const raw = request && request.url;
  try {
    return { ok: true, parsed: new URL(typeof raw === "string" ? raw : "") };
  } catch {
    return { ok: false, status: 400, error: "filled url isn't parseable." };
  }
}

// Confirms a value did not move the request to a different protocol/host/port or add
// userinfo. Each check has its own status (400 for malformed, 403 for not allowed) so the
// caller can surface the right error without further branching.
function compareUrlShape(planned, filled) {
  if (filled.protocol !== "https:") return { ok: false, status: 403, error: "filled url must use https." };
  if (filled.username || filled.password) return { ok: false, status: 400, error: "filled url must not carry credentials." };
  if (filled.port && filled.port !== "443") return { ok: false, status: 403, error: "filled url port must be 443 or default." };
  if (planned.hostname.toLowerCase() !== filled.hostname.toLowerCase()) {
    return { ok: false, status: 403, error: `a secret value moved the request to host ${filled.hostname}.` };
  }
  if ((planned.port || "") !== (filled.port || "")) {
    return { ok: false, status: 403, error: `a secret value moved the request to port ${filled.port || "(default)"}.` };
  }
  return { ok: true };
}

// A percent-encoded slash, backslash or dot segment in the planned OR filled path
// refuses the request: a server that decodes them could land on a path the rule didn't
// match. Case-insensitive, so %2F / %5C / %2E are refused alongside their lowercase forms.
function checkPathEscapes(plannedPath, filledPath) {
  if (pathHasEscapes(plannedPath) || pathHasEscapes(filledPath)) {
    return { ok: false, status: 400, error: "path contains %2f, %5c, or %2e (a server could decode them to a different path)." };
  }
  return { ok: true };
}

// Each placeholder secret's own rule (host, method, path prefix) is re-run against the
// filled path. The method doesn't change between plan and fill, so plan.method is the
// one to test, and a refusal here names the secret so the caller can fix it in the
// manifest.
function checkSecretsAgainstFilled(policy, plan, filledHostname, filledPathAndQuery) {
  const ruleAllowsSecret = policyMod().ruleAllowsSecret;
  for (const name of plan.names) {
    const verdict = ruleAllowsSecret(policy, name, filledHostname, plan.method, filledPathAndQuery);
    if (verdict) return { ok: false, status: 403, error: verdict };
  }
  return { ok: true };
}

// Re-checks the filled request after fillSecrets swapped placeholders for values. A value
// in the URL must NOT move the request: protocol, hostname and port must match the planned
// URL exactly, and the filled URL must not carry credentials. Each placeholder secret's own
// rule (host, method, path prefix) is re-run against the filled path so a value can never
// land on a path the manifest didn't allow. A percent-encoded slash, backslash or dot
// segment (%2f, %5c, %2e, any case) in the planned OR filled path refuses the request: a
// server that decodes them could escape the path-prefix rule.
function verifyFilledUrl(plan, request, policy) {
  if (!plan || !plan.ok) return { ok: false, status: 400, error: "plan is missing." };
  const plannedResult = parsePlannedUrl(plan);
  if (!plannedResult.ok) return plannedResult;
  const planned = plannedResult.parsed;
  const filledResult = parseFilledUrl(request);
  if (!filledResult.ok) return filledResult;
  const filled = filledResult.parsed;
  const shape = compareUrlShape(planned, filled);
  if (!shape.ok) return shape;
  const escapeCheck = checkPathEscapes(planned.pathname || "/", filled.pathname || "/");
  if (!escapeCheck.ok) return escapeCheck;
  const secretsCheck = checkSecretsAgainstFilled(policy, plan, filled.hostname.toLowerCase(), `${filled.pathname || "/"}${filled.search || ""}`);
  if (!secretsCheck.ok) return secretsCheck;
  return { ok: true, filledUrl: filled.toString() };
}

module.exports = { verifyFilledUrl };