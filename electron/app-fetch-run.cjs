// The fetch executor for hosted mini apps (docs/architecture/mini-app-hosting.md): takes a
// planned request, fills its placeholders, looks the host up in DNS, refuses if any resolved
// address is private, sends it with a timeout and a byte cap, and returns a masked result.
// Depends only on the policy module and on injected fetch/lookup so Electron main and the
// weft.zip route share one implementation. The DNS check is best-effort: the address lookup
// happens before the connection, and a TOCTOU re-binding between lookup and connect is the
// known gap we don't close here. Pinning the connection to the checked address needs an HTTP
// proxy that does the binding; that's a future move.

const { fillSecrets, isPrivateAddress, maskSecrets, planFetch } = require("./app-fetch-policy.cjs");
const { verifyFilledUrl } = require("./app-fetch-filled.cjs");

// Headers the page is allowed to see in the response. We deliberately do NOT forward hop-by-hop
// or routing headers (the same set planFetch refuses on the way in) so the app can't see them
// either. Rate-limit headers are kept so the page can pace itself.
const ALLOWED_RESPONSE_HEADERS = new Set([
  "content-type",
  "content-length",
  "cache-control",
  "etag",
  "last-modified",
  "location",
  "retry-after",
]);

// Anything starting with x-ratelimit- (case-insensitive) passes through, so providers that
// publish rate-limit windows don't have to be known by name.
const RATE_LIMIT_HEADER = /^x-ratelimit-/i;

// Content types the page receives as utf8 text. JSON, XML, HTML, form-urlencoded, JavaScript
// and a few common subtypes. Anything else is sent back as base64 so binary bytes round-trip
// through the JSON bridge.
const TEXTUAL_TYPES = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-www-form-urlencoded",
  "application/xml+rss",
  "application/atom+xml",
  "application/vnd.api+json",
  "application/ld+json",
];

// `https.get` / `https.request` resolve a hostname to one or more addresses; we ask for all and
// refuse the request if ANY of them is private. With all:true on dns.lookup the result is
// `[{ address, family }, ...]`. lookup is injected so the test can avoid real DNS.
function checkHostAddresses(hostname, lookup) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, addresses) => {
      if (done) return;
      done = true;
      resolve({ ok, addresses });
    };
    try {
      lookup(hostname, { all: true }, (err, addresses) => {
        if (err || !Array.isArray(addresses) || addresses.length === 0) return finish(false, null);
        const privateAddr = addresses.find((a) => isPrivateAddress(a.address));
        if (privateAddr) return finish(false, privateAddr.address);
        finish(true, addresses.map((a) => a.address));
      });
    } catch (err) {
      finish(false, null);
    }
  });
}

// Reads the body with a byte cap, returning { text, encoding, truncated }. Stops reading once
// the cap is reached; the rest is left in the stream and the connection is closed on the way
// out. The encoding is utf8 for textual content types (and for a missing type whose bytes
// decode cleanly), base64 otherwise.
function isTextualContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  if (!ct) return false;
  return TEXTUAL_TYPES.some((prefix) => ct === prefix || ct.startsWith(prefix));
}

// Streams the response body chunk by chunk with a byte cap. Once we cross `maxBytes` we stop
// reading and cancel the underlying reader; the connection is closed when its refcount
// drops out. Falls back to arrayBuffer() when the fetch implementation doesn't expose a body.
async function readResponseBody({ response, maxBytes, contentType, values }) {
  if (!response.body) {
    let binary = Buffer.from(await response.arrayBuffer());
    let truncated = false;
    if (binary.length > maxBytes) {
      binary = binary.subarray(0, maxBytes);
      truncated = true;
    }
    return { ...encodeBody({ binary, contentType, truncated, values }), truncated };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      let chunk = Buffer.from(value);
      const remaining = maxBytes - total;
      if (chunk.length > remaining) {
        chunk = chunk.subarray(0, remaining);
        truncated = true;
      }
      chunks.push(chunk);
      total += chunk.length;
      if (truncated) break;
    }
  } finally {
    if (truncated) {
      try {
        await reader.cancel();
      } catch {}
    }
  }
  return { ...encodeBody({ binary: Buffer.concat(chunks, total), contentType, truncated, values }), truncated };
}

// Sends the request through fetch, owning the AbortController and its timer. Returns the
// Response or throws on abort (504) / network failure (502).
async function callFetch({ url, method, headers, body, fetchImpl, host, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (err) {
    if (err && (err.name === "AbortError" || controller.signal.aborted)) {
      throw fail(504, `request to ${host} timed out after ${timeoutMs}ms.`);
    }
    throw fail(502, err && err.message ? err.message : "fetch failed.");
  } finally {
    clearTimeout(timer);
  }
}

function encodeBody({ binary, contentType, truncated, values }) {
  // A set content type decides utf8 vs base64; a missing type whose bytes happen to be utf8
  // is treated as text per the spec. A set non-textual type (application/octet-stream) is
  // always base64, even when the bytes would parse as utf8.
  const textual = isTextualContentType(contentType);
  if (textual) {
    return { body: maskSecrets(binary.toString("utf8"), values), bodyEncoding: "utf8", truncated };
  }
  if (!contentType && looksLikeUtf8(binary)) {
    return { body: maskSecrets(binary.toString("utf8"), values), bodyEncoding: "utf8", truncated };
  }
  return { body: binary.toString("base64"), bodyEncoding: "base64", truncated };
}

// A quick check that the bytes are valid utf8: a decoder round-trip should reproduce the same
// string with the same byte count. Binary content (an image, a zip) usually fails this.
function looksLikeUtf8(binary) {
  try {
    const text = binary.toString("utf8");
    return Buffer.from(text, "utf8").equals(binary);
  } catch {
    return false;
  }
}

// Caps an error to a usable status, never lets it pass untyped to the bridge.
function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function runFetch({ policy, request, getValues, fetch: fetchImpl, lookup, timeoutMs = 15000, maxBytes = 4_000_000 }) {
  if (typeof fetchImpl !== "function") throw new Error("runFetch needs a fetch implementation.");
  if (typeof lookup !== "function") throw new Error("runFetch needs a dns.lookup function.");

  const plan = planFetch(policy, request);
  if (!plan.ok) throw fail(plan.status, plan.error);

  const values = await resolveValues(plan.names, getValues);
  const filled = fillSecrets(request, values);

  // Re-check the URL after the placeholders have been swapped for values. planFetch only
  // saw the planned one, so a value sitting in the URL (a query string like
  // `?key={{secret:K}}`) wouldn't have reached the server without this. We send the filled
  // URL, but only after re-checking protocol/host/port, refusing new credentials, and
  // re-running each placeholder secret's own rule against the filled path.
  const verified = verifyFilledUrl(plan, filled, policy);
  if (!verified.ok) throw fail(verified.status, verified.error);
  const filledUrl = verified.filledUrl;

  // DNS check: refuse the request if any resolved address is private. We pass the hostname to
  // fetch, not the resolved IP, so the connection re-resolves and a TOCTOU re-bind between
  // this lookup and the actual connect is the gap. Pinning needs an HTTP proxy that does the
  // binding, which is a future move.
  const host = new URL(filledUrl).hostname;
  const dns = await checkHostAddresses(host, lookup);
  if (!dns.ok) throw fail(403, `host ${host} resolves to a private address.`);

  const response = await callFetch({
    url: filledUrl,
    method: plan.method,
    headers: filled.headers,
    body: filled.body,
    fetchImpl,
    host,
    timeoutMs,
  });

  // Body read with a byte cap. Past the cap we set a 413 status but still return the bytes
  // read so the page can at least see what was there; the caller decides what to do.
  const rawContentType = response.headers.get("content-type") ?? "";
  const { body, bodyEncoding, truncated } = await readResponseBody({
    response,
    maxBytes,
    contentType: rawContentType,
    values,
  });
  if (truncated && body.length >= maxBytes) throw fail(413, `response exceeded ${maxBytes} bytes.`);

  return {
    status: response.status,
    ok: response.ok,
    headers: collectResponseHeaders(response, values),
    body,
    bodyEncoding,
  };
}

// Resolves the placeholders planFetch found, or returns an empty map when the request has
// none. A missing name is a 409 (the secret layer is the one that knows it isn't set).
async function resolveValues(names, getValues) {
  if (names.length === 0) return {};
  if (typeof getValues !== "function") throw fail(403, "this request needs secrets but getValues wasn't provided.");
  const resolved = await getValues(names);
  const missing = names.filter((n) => !(n in resolved));
  if (missing.length > 0) throw fail(409, `${missing[0]} isn't set.`);
  return resolved;
}

// Builds the masked, lowercased header set we ship back. Header values are always text, so
// every secret value is masked; x-ratelimit-* passes through.
function collectResponseHeaders(response, values) {
  const out = {};
  response.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!ALLOWED_RESPONSE_HEADERS.has(lower) && !RATE_LIMIT_HEADER.test(lower)) return;
    out[lower] = maskSecrets(value, values);
  });
  return out;
}

// The path the route logs for a request, derived from the PLAN, never from the filled URL:
// a placeholder in the query may carry a secret, and the filled URL is the value the page
// asked us to send. Routes call this with the result of planFetch so a value never crosses
// into the cloud_app_fetches row, the server log or any other log line.
function loggablePath(plan) {
  if (!plan || !plan.ok) return "";
  try {
    const parsed = new URL(plan.url);
    return parsed.pathname || "/";
  } catch {
    return "";
  }
}

module.exports = { runFetch, loggablePath, ALLOWED_RESPONSE_HEADERS, TEXTUAL_TYPES };
