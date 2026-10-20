// The fetch policy for hosted mini apps (docs/architecture/mini-app-hosting.md): parses the app's
// weft-app.json manifest into rules, plans a request against those rules, masks values the server
// echoes back. Pure and dependency-free so both Electron main and the weft.zip route share one
// implementation; tests inject nothing.

const { hostMatches, isPrivateAddress, IPV4_RE, normaliseHost, pathMatches } = require("./app-fetch-policy-helpers.cjs");

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

// `{{secret:NAME}}` placed by the app in the request. Anywhere except inside a header value
// counts: the URL, header values and the body. A HEADER NAME placeholder is refused.
const PLACEHOLDER = /\{\{secret:([A-Za-z_][A-Za-z0-9_]{0,63})\}\}/g;

function collectNames(names, text) {
  if (typeof text !== "string" || !text) return;
  PLACEHOLDER.lastIndex = 0;
  let match;
  while ((match = PLACEHOLDER.exec(text)) !== null) names.push(match[1]);
}

// The distinct NAMEs in placeholders across the URL, every header value and the body, in the
// order they appear. planFetch uses it to decide whether a request even needs the secret layer
// (a request with no placeholders still has to be allowed by some rule, just to keep weft.fetch
// from being an open proxy to whoever the manifest points at).
function secretNames(request) {
  const names = [];
  if (!request || typeof request !== "object") return names;
  collectNames(names, request.url);
  if (request.headers && typeof request.headers === "object") {
    for (const value of Object.values(request.headers)) collectNames(names, value);
  }
  collectNames(names, request.body);
  return Array.from(new Set(names));
}

// Parses one secret rule's `methods` list: defaults to ["GET"], uppercases, dedups. Returns
// the array or null when any method is invalid (the caller drops the whole rule). Defined in
// app-fetch-parse-secret.cjs so this module stays under the 300-line cap.
const { parseSecretRule } = require("./app-fetch-parse-secret.cjs");

// Parses the manifest into the runtime policy. Names match the placeholder shape; hosts go
// through normaliseHost; methods are uppercased to the allowed set; paths must start with "/"
// and default to "/". A malformed entry is dropped and listed in `problems`, never silently
// loosened. Undefined `secrets` and `public` each default to {} / [].
function parsePolicy(manifest) {
  const out = { secrets: {}, public: [], problems: [] };
  if (!manifest || typeof manifest !== "object") return out;
  if (Array.isArray(manifest.public)) {
    for (const item of manifest.public) {
      if (typeof item !== "string" || !NAME_RE.test(item)) {
        out.problems.push(`public ${JSON.stringify(item)} isn't a valid name.`);
        continue;
      }
      out.public.push(item);
    }
  } else if (manifest.public !== undefined) {
    out.problems.push("public must be an array of names.");
  }
  const secrets = manifest.secrets;
  if (secrets === undefined) return out;
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    out.problems.push("secrets must be an object of names and rules.");
    return out;
  }
  for (const [name, rule] of Object.entries(secrets)) {
    if (!NAME_RE.test(name)) {
      out.problems.push(`secret ${JSON.stringify(name)} isn't a valid name.`);
      continue;
    }
    const parsed = parseSecretRule(name, rule);
    if (parsed.rule) out.secrets[name] = parsed.rule;
    out.problems.push(...parsed.problems);
  }
  return out;
}

// Replaces every `{{secret:NAME}}` placeholder in a string. A name not in `values` is left
// as-is (runFetch is the one that complains, so a partial fill doesn't double-mask).
function replacePlaceholders(text, values) {
  if (typeof text !== "string") return text;
  return text.replace(PLACEHOLDER, (full, name) => (values && Object.prototype.hasOwnProperty.call(values, name) ? values[name] : full));
}

// Walks the request and fills every placeholder in the URL, every header value and the body.
function fillSecrets(request, values) {
  const out = { ...request };
  if (typeof out.url === "string") out.url = replacePlaceholders(out.url, values);
  if (out.headers && typeof out.headers === "object") {
    const next = {};
    for (const [k, v] of Object.entries(out.headers)) next[k] = replacePlaceholders(v, values);
    out.headers = next;
  }
  if (typeof out.body === "string") out.body = replacePlaceholders(out.body, values);
  return out;
}

// The inverse of fillSecrets: replace each value with `‹NAME›` so the page never echoes the
// secret. A value shorter than four characters is left alone. utf8 only: callers mask binary
// bodies as base64 first, so the value won't appear mid-stream.
function maskSecrets(text, values) {
  if (typeof text !== "string" || !text || !values) return text;
  let out = text;
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "string" || value.length < 4) continue;
    out = out.split(value).join(`‹${name}›`);
  }
  return out;
}

// Headers the app may NOT send, exact match. Routing headers are not silently dropped; a
// retry-against-different-host would be a quiet privilege escalation. The wildcard prefixes
// `proxy-*` and `x-forwarded-*` are matched separately, the same way the spec lists them.
const FORBIDDEN_HEADERS = new Set([
  "host", "connection", "content-length", "transfer-encoding",
  "cookie", "upgrade", "te", "trailer", "keep-alive", "x-real-ip",
]);

// Refuses a single header when its name is forbidden or its value isn't a string; otherwise
// records the lowercased header. Returns a refusal or null.
function checkRequestHeader(rawName, rawValue, headers) {
  const lowerName = String(rawName).toLowerCase();
  if (FORBIDDEN_HEADERS.has(lowerName) || lowerName.startsWith("proxy-") || lowerName.startsWith("x-forwarded-")) {
    return { ok: false, status: 403, error: `header ${JSON.stringify(rawName)} isn't allowed.` };
  }
  PLACEHOLDER.lastIndex = 0;
  if (PLACEHOLDER.test(lowerName)) return { ok: false, status: 403, error: "header name placeholders aren't allowed." };
  if (typeof rawValue !== "string") return { ok: false, status: 400, error: `header ${JSON.stringify(rawName)} value isn't a string.` };
  headers[lowerName] = rawValue;
  return null;
}

// Walks the request's headers, forbidding the sensitive ones and any with a placeholder NAME.
function parseRequestHeaders(request) {
  const headers = {};
  if (request.headers === undefined) return { ok: true, headers };
  if (!request.headers || typeof request.headers !== "object" || Array.isArray(request.headers)) {
    return { ok: false, status: 400, error: "headers must be an object." };
  }
  for (const [rawName, rawValue] of Object.entries(request.headers)) {
    const verdict = checkRequestHeader(rawName, rawValue, headers);
    if (verdict) return verdict;
  }
  return { ok: true, headers };
}

// True when SOME rule allows this host/method/path. Used to keep weft.fetch from being an
// open proxy when the request carries no placeholders.
function anyRuleAllows(policy, hostname, method, path) {
  for (const rule of Object.values((policy && policy.secrets) || {})) {
    if (!rule.methods.includes(method)) continue;
    if (!rule.hosts.some((h) => hostMatches(h, hostname))) continue;
    if (!pathMatches(rule.paths, path)) continue;
    return true;
  }
  return false;
}

// True when a secret's own rule allows the call, or returns the refusal reason.
function ruleAllowsSecret(policy, name, hostname, method, path) {
  const rule = policy && policy.secrets && policy.secrets[name];
  if (!rule) return `secret ${name} isn't in the policy.`;
  if (!rule.methods.includes(method)) return `secret ${name} doesn't allow ${method}.`;
  if (!rule.hosts.some((h) => hostMatches(h, hostname))) return `secret ${name} doesn't allow host ${hostname}.`;
  if (!pathMatches(rule.paths, path)) return `secret ${name} doesn't allow path ${path}.`;
  return null;
}

// Refuses a request by URL, method or header policy. Returns { ok: true, ... } with the names
// the placeholders asked for, or { ok: false, status, error } with a 400 (malformed) or 403
// (refused by some rule). planFetch is what runFetch uses before any network call.
function planFetch(policy, request) {
  const shape = planRequestShape(request);
  if (!shape.ok) return shape;
  const { parsed, hostname, method, path } = shape;
  const names = secretNames(request);
  if (names.length === 0) {
    if (!anyRuleAllows(policy, hostname, method, path)) {
      return { ok: false, status: 403, error: `no rule allows ${method} ${hostname}${path}.` };
    }
    return { ok: true, url: parsed.toString(), method, names };
  }
  for (const name of names) {
    const verdict = ruleAllowsSecret(policy, name, hostname, method, path);
    if (verdict) return { ok: false, status: 403, error: verdict };
  }
  return { ok: true, url: parsed.toString(), method, names };
}

// Validates the request's URL, hostname shape, method and headers; returns the parsed
// pieces or a refusal. planFetch calls this once and then asks the policy for a verdict.
function planRequestShape(request) {
  const urlResult = parseRequestUrl(request);
  if (!urlResult.ok) return urlResult;
  const { parsed } = urlResult;
  const hostname = parsed.hostname.toLowerCase();
  const hostRefusal = checkHostnameShape(hostname);
  if (hostRefusal) return hostRefusal;
  const method = typeof request.method === "string" && request.method ? request.method.toUpperCase() : "";
  if (!METHODS.has(method)) return { ok: false, status: 400, error: `method ${JSON.stringify(request.method)} isn't allowed.` };
  const headerResult = parseRequestHeaders(request);
  if (!headerResult.ok) return headerResult;
  return { ok: true, parsed, hostname, method, path: `${parsed.pathname || "/"}${parsed.search || ""}` };
}

// Parses and validates the request's URL string. Returns the parsed URL or a refusal.
function parseRequestUrl(request) {
  if (!request || typeof request !== "object") return { ok: false, status: 400, error: "request is missing." };
  if (typeof request.url !== "string" || !request.url) return { ok: false, status: 400, error: "url is missing." };
  let parsed;
  try {
    parsed = new URL(request.url);
  } catch {
    return { ok: false, status: 400, error: "url isn't parseable." };
  }
  if (parsed.protocol !== "https:") return { ok: false, status: 403, error: "protocol must be https." };
  if (parsed.username || parsed.password) return { ok: false, status: 400, error: "url must not carry credentials." };
  if (parsed.port && parsed.port !== "443") return { ok: false, status: 403, error: "port must be 443 or default." };
  return { ok: true, parsed };
}

// Returns a refusal object when the hostname isn't a public DNS name; null when it is.
function checkHostnameShape(hostname) {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return { ok: false, status: 403, error: "ip literals aren't allowed." };
  if (!hostname || hostname.length > 253) return { ok: false, status: 403, error: "hostname isn't allowed." };
  if (IPV4_RE.test(hostname)) return { ok: false, status: 403, error: "ip literals aren't allowed." };
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { ok: false, status: 403, error: "localhost names aren't allowed." };
  }
  return null;
}

// Re-checks the filled request after fillSecrets swapped placeholders for values. A value
// in the URL must NOT move the request: protocol, hostname and port must match the planned
// URL exactly, and the filled URL must not carry credentials. Each placeholder secret's own
// rule (host, method, path prefix) is re-run against the filled path so a value can never
// land on a path the manifest didn't allow. A percent-encoded slash, backslash or dot
// segment (%2f, %5c, %2e, any case) in the planned OR filled path refuses the request:
// a server that decodes them could escape the path-prefix rule.
//
// Lives in app-fetch-filled.cjs so this module stays under the 300-line cap. The runner
// imports `verifyFilledUrl` from there.
module.exports = {
  parsePolicy,
  secretNames,
  planFetch,
  isPrivateAddress,
  fillSecrets,
  maskSecrets,
  // Used by app-fetch-filled.cjs to re-run a secret's own rule against the filled path.
  ruleAllowsSecret,
  // Exported for tests.
  PLACEHOLDER,
  METHODS,
  FORBIDDEN_HEADERS,
};
