// Hostname and IP helpers split out of app-fetch-policy.cjs so it stays under the 300-line
// cap. Pure: no dependencies, no I/O. The shape of `hostMatches` is exact match for an
// exact rule, and a single-label subdomain of the rule's base for a wildcard. The IPv4
// table covers the IANA special-purpose private ranges; the >= 224 row in isV4Private
// covers multicast and the 240/4 reserved block. IPv4-mapped IPv6 is translated to v4
// first so a ::ffff:127.0.0.1 form can't escape the v4 rules.

const LABEL_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

const V4_PRIVATE = [
  [0, 0, 0, 0, 0, 255, 255, 255],
  [10, 0, 0, 0, 10, 255, 255, 255],
  [100, 64, 0, 0, 100, 127, 255, 255],
  [127, 0, 0, 0, 127, 255, 255, 255],
  [169, 254, 0, 0, 169, 254, 255, 255],
  [172, 16, 0, 0, 172, 31, 255, 255],
  [192, 0, 0, 0, 192, 0, 0, 255],
  [192, 168, 0, 0, 192, 168, 255, 255],
  [198, 18, 0, 0, 198, 19, 255, 255],
];

function v4Number(a, b, c, d) {
  return ((a * 0x100 + b) * 0x100 + c) * 0x100 + d;
}

function isV4Private(parts) {
  const [a, b, c, d] = parts;
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  if (a >= 224) return true; // 224.0.0.0/4 multicast and the 240/4 reserved block
  const num = v4Number(a, b, c, d);
  for (const r of V4_PRIVATE) {
    if (num >= v4Number(r[0], r[1], r[2], r[3]) && num <= v4Number(r[4], r[5], r[6], r[7])) return true;
  }
  return false;
}

// True when the IP literal falls into any private or loopback range, or is otherwise not a
// public unicast address.
function isPrivateAddress(ip) {
  if (typeof ip !== "string" || !ip) return true;
  const text = ip.split("%")[0].toLowerCase();
  if (text === "::" || text === "0.0.0.0" || text === "::1") return true;
  // IPv4-mapped IPv6 in dotted form: ::ffff:a.b.c.d or the deprecated ::a.b.c.d.
  const v4Mapped = text.match(/^::(?:ffff:)?([0-9.]+)$/);
  if (v4Mapped) return isV4Private(v4Mapped[1].split(".").map(Number));
  if (IPV4_RE.test(text)) return isV4Private(text.split(".").map(Number));
  // IPv4-mapped IPv6 in hex form, e.g. ::ffff:7f00:0001 = 127.0.0.1.
  const v4MappedHex = text.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4MappedHex) {
    const hi = parseInt(v4MappedHex[1], 16);
    const lo = parseInt(v4MappedHex[2], 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return true;
    return isV4Private([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
  }
  if (text.includes(":")) {
    if (/^fe[89ab][0-9a-f]:/i.test(text)) return true; // fe80::/10 link-local
    if (/^(fc|fd)[0-9a-f]{2}:/i.test(text)) return true; // fc00::/7 unique-local
    if (/^ff[0-9a-f]{2}:/i.test(text)) return true; // ff00::/8 multicast
    return false;
  }
  return true;
}

// Hosts an app may talk to. Two shapes: an exact lowercase hostname ("api.stripe.com") or a
// wildcard prefix ("*.example.com"); the wildcard matches subdomains of `example.com` only,
// never the apex and never a deeper suffix like "evil-example.com". IPs, ports, schemes,
// userinfo and the bare "*" are rejected.
function normaliseHost(rule) {
  if (typeof rule !== "string") return null;
  const trimmed = rule.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || trimmed === "*") return null;
  if (trimmed.includes("/") || trimmed.includes(":") || /\s/.test(trimmed)) return null;
  if (IPV4_RE.test(trimmed)) return null;
  if (trimmed.startsWith("*.")) {
    const base = trimmed.slice(2);
    if (!base || !base.includes(".") || !LABEL_RE.test(base)) return null;
    return { kind: "wildcard", base };
  }
  if (!trimmed.includes(".") || !LABEL_RE.test(trimmed)) return null;
  return { kind: "exact", name: trimmed };
}

// True when a hostname matches a rule. The wildcard matches a single-label subdomain of the
// rule's base, never the base itself and never a deeper subdomain.
function hostMatches(rule, hostname) {
  if (!hostname) return false;
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (rule.kind === "exact") return lower === rule.name;
  const hostLabels = lower.split(".");
  const baseLabels = rule.base.split(".");
  if (hostLabels.length !== baseLabels.length + 1) return false;
  for (let i = 0; i < baseLabels.length; i++) {
    if (hostLabels[i + 1] !== baseLabels[i]) return false;
  }
  return LABEL_RE.test(hostLabels[0]);
}

// True when a request path matches one of the rule's prefixes. The prefix must equal the path
// alone (without the query), or the request continues at the prefix's boundary (a "/" or "?").
// "/v1/charges" does not match "/v1/chargesX"; "/v1/charges/" does match "/v1/charges/123".
function pathMatches(rules, pathAndQuery) {
  const path = pathAndQuery.split("?")[0];
  for (const prefix of rules) {
    if (path === prefix) return true;
    if (prefix.endsWith("/")) {
      if (pathAndQuery.startsWith(prefix)) return true;
    } else if (pathAndQuery.startsWith(`${prefix}/`) || pathAndQuery.startsWith(`${prefix}?`)) {
      return true;
    }
  }
  return false;
}

// True when the path carries a percent-encoded slash, backslash or dot segment. A server that
// decodes them can land on a different path than the one the rule matched, so we refuse any of
// them up front instead of relying on the policy rule's matching against the decoded path.
function pathHasEscapes(path) {
  if (typeof path !== "string" || !path) return false;
  const lower = path.toLowerCase();
  return lower.includes("%2f") || lower.includes("%5c") || lower.includes("%2e");
}

module.exports = { hostMatches, isPrivateAddress, normaliseHost, pathMatches, pathHasEscapes, LABEL_RE, IPV4_RE };
