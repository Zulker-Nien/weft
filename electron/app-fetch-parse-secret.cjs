// Splits out of app-fetch-policy.cjs so the policy module stays under the 300-line cap:
// parses one manifest `secrets` rule (methods, paths, hosts, `from`) into a runtime
// { from, hosts, methods, paths } shape, dropping the whole rule and listing a problem
// string for any malformed entry. A host that doesn't normalise drops the whole rule — we
// never keep a partial hosts list, because silent partial acceptance is a footgun.

const { normaliseHost } = require("./app-fetch-policy-helpers.cjs");

// METHODS mirrors the set app-fetch-policy.cjs exposes. Kept local to avoid a circular
// require (policy -> this module -> policy would already be empty when read at require
// time). The set is tiny and never changes.
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

// Parses one secret rule's `methods` list: defaults to ["GET"], uppercases, dedups. Returns
// the array or null when any method is invalid (the caller drops the whole rule).
function parseMethods(name, methodsRaw, problems) {
  if (methodsRaw === undefined) return ["GET"];
  if (!Array.isArray(methodsRaw) || methodsRaw.length === 0) {
    problems.push(`secret ${name} methods must be a non-empty list.`);
    return null;
  }
  const out = [];
  for (const m of methodsRaw) {
    const upper = typeof m === "string" ? m.toUpperCase() : "";
    if (!METHODS.has(upper)) {
      problems.push(`secret ${name} method ${JSON.stringify(m)} isn't allowed.`);
      return null;
    }
    if (!out.includes(upper)) out.push(upper);
  }
  return out;
}

// Same shape for paths. A path must start with "/".
function parsePaths(name, pathsRaw, problems) {
  if (pathsRaw === undefined) return ["/"];
  if (!Array.isArray(pathsRaw) || pathsRaw.length === 0) {
    problems.push(`secret ${name} paths must be a non-empty list.`);
    return null;
  }
  const out = [];
  for (const p of pathsRaw) {
    if (typeof p !== "string" || !p.startsWith("/")) {
      problems.push(`secret ${name} path ${JSON.stringify(p)} must start with "/".`);
      return null;
    }
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

// Parses the manifest's `secrets` map: each rule becomes { from, hosts, methods, paths }, or
// is dropped with a problem string.
function parseSecretRule(name, rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    return { problems: [`secret ${name} rule isn't an object.`] };
  }
  const problems = [];
  if (rule.from !== undefined && rule.from !== "author" && rule.from !== "viewer") {
    problems.push(`secret ${name} from must be "author" or "viewer".`);
    return { problems };
  }
  if (!Array.isArray(rule.hosts) || rule.hosts.length === 0) {
    return { problems: [`secret ${name} hosts must be a non-empty list.`] };
  }
  const hosts = [];
  for (const host of rule.hosts) {
    const parsed = normaliseHost(host);
    if (!parsed) problems.push(`secret ${name} host ${JSON.stringify(host)} isn't allowed.`);
    else hosts.push(parsed);
  }
  if (hosts.length !== rule.hosts.length) return { problems };
  const methods = parseMethods(name, rule.methods, problems);
  if (!methods) return { problems };
  const paths = parsePaths(name, rule.paths, problems);
  if (!paths) return { problems };
  return {
    rule: { from: rule.from === "viewer" ? "viewer" : "author", hosts, methods, paths },
    problems,
  };
}

module.exports = { parseSecretRule, parseMethods, parsePaths, METHODS };