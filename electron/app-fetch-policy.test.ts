// The fetch policy for hosted mini apps: parses manifests, plans a request, masks values. The
// tests are table-driven so each refusal and each edge of the hostname / path / IP rules has its
// own row and a fresh error message when it breaks. Pure module, so nothing to set up.

import { describe, expect, it } from "vitest";
import {
  fillSecrets,
  isPrivateAddress,
  maskSecrets,
  parsePolicy,
  planFetch,
  secretNames,
  type ParsedPolicy,
} from "./app-fetch-policy.cjs";

const policy: ParsedPolicy = parsePolicy({
  secrets: {
    STRIPE_KEY: { hosts: ["api.stripe.com", "*.stripe.com"], methods: ["GET"], paths: ["/v1/charges"] },
    OPENAI: { from: "viewer", hosts: ["api.openai.com"], methods: ["POST"], paths: ["/v1/responses", "/v1/"] },
    SUPA: { hosts: ["lqjyravglujyizyqypxq.supabase.co"], methods: ["GET", "POST"], paths: ["/rest/v1/rpc/"] },
  },
  public: ["SUPABASE_PUBLISHABLE_KEY"],
});

// What planFetch must answer: {ok:true,...} with the names, or {ok:false,status,error} on refusal.
const ok = (names: string[] = []) => ({ ok: true, names });
const no = (status: 400 | 403, errorIncludes: string) => ({ ok: false, status, errorMatches: errorIncludes });

const cases: Array<{ name: string; policy?: ParsedPolicy; request: Record<string, unknown>; expect: ReturnType<typeof ok> | ReturnType<typeof no> }> = [
  // A request with no placeholders must still be allowed by SOME rule.
  { name: "no placeholders, allowed by exact host", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET" }, expect: ok() },
  { name: "no placeholders, allowed by wildcard host", policy, request: { url: "https://api.openai.com/v1/responses", method: "POST" }, expect: ok() },
  { name: "no placeholders, host not in any rule", policy, request: { url: "https://example.com/", method: "GET" }, expect: no(403, "no rule allows") },
  { name: "no placeholders, path not in rule", policy, request: { url: "https://api.stripe.com/v1/refunds", method: "GET" }, expect: no(403, "no rule allows") },
  { name: "no placeholders, method not in rule", policy, request: { url: "https://api.stripe.com/v1/charges", method: "POST" }, expect: no(403, "no rule allows") },
  { name: "no placeholders, empty policy", policy: { secrets: {}, public: [], problems: [] }, request: { url: "https://api.stripe.com/", method: "GET" }, expect: no(403, "no rule allows") },

  // A request with placeholders must have each NAME declared and its own rule allow the call.
  { name: "placeholder, declared and allowed", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } }, expect: ok(["STRIPE_KEY"]) },
  { name: "placeholder, host not in its rule", policy, request: { url: "https://example.com/v1/charges", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } }, expect: no(403, "STRIPE_KEY doesn't allow host") },
  { name: "placeholder, method not in its rule", policy, request: { url: "https://api.stripe.com/v1/charges", method: "POST", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } }, expect: no(403, "STRIPE_KEY doesn't allow") },
  { name: "placeholder, path not in its rule", policy, request: { url: "https://api.stripe.com/v1/refunds", method: "GET", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } }, expect: no(403, "STRIPE_KEY doesn't allow path") },
  { name: "placeholder, name not declared", policy, request: { url: "https://example.com/", method: "GET", headers: { authorization: "Bearer {{secret:MISSING}}" } }, expect: no(403, "MISSING isn't in the policy") },
  { name: "placeholder in body", policy, request: { url: "https://api.openai.com/v1/responses", method: "POST", body: "{\"key\":\"{{secret:OPENAI}}\"}" }, expect: ok(["OPENAI"]) },
  { name: "two distinct placeholders, each checked", policy, request: { url: "https://api.stripe.com/v1/charges?alt={{secret:STRIPE_KEY}}", method: "GET", headers: { authorization: "Bearer {{secret:OPENAI}}" } }, expect: no(403, "OPENAI") },

  // Wildcard: matches one-level subdomain only.
  { name: "wildcard matches direct subdomain", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET" }, expect: ok() },
  { name: "wildcard matches deeper label still under the rule's base", policy, request: { url: "https://files.stripe.com/v1/charges", method: "GET" }, expect: ok() },
  { name: "wildcard never matches the apex", request: { url: "https://stripe.com/v1/charges", method: "GET" }, expect: no(403, "no rule allows") },
  { name: "wildcard never matches a deeper subdomain", policy: parsePolicy({ secrets: { X: { hosts: ["*.example.com"], methods: ["GET"], paths: ["/"] } } }), request: { url: "https://a.b.example.com/", method: "GET" }, expect: no(403, "no rule allows") },
  { name: "wildcard never matches a suffix trick", policy: parsePolicy({ secrets: { X: { hosts: ["*.example.com"], methods: ["GET"], paths: ["/"] } } }), request: { url: "https://evil-example.com/", method: "GET" }, expect: no(403, "no rule allows") },

  // Path matching: prefix boundaries, query, no "/chargesX" without the boundary.
  { name: "path equal to prefix", policy, request: { url: "https://lqjyravglujyizyqypxq.supabase.co/rest/v1/rpc/growth_signups", method: "GET" }, expect: ok() },
  { name: "path with slash continuation", policy, request: { url: "https://api.openai.com/v1/responses/123", method: "POST" }, expect: ok() },
  { name: "path prefix /v1/ doesn't match /v1X", policy: parsePolicy({ secrets: { X: { hosts: ["api.openai.com"], methods: ["GET"], paths: ["/v1/"] } } }), request: { url: "https://api.openai.com/v1X", method: "GET", headers: { authorization: "Bearer {{secret:X}}" } }, expect: no(403, "X doesn't allow path") },
  { name: "path with query after prefix", policy: parsePolicy({ secrets: { X: { hosts: ["api.example.com"], methods: ["GET"], paths: ["/v1/charges"] } } }), request: { url: "https://api.example.com/v1/charges?limit=10", method: "GET" }, expect: ok() },
  { name: "trailing-slash rule matches sub-paths", policy: parsePolicy({ secrets: { X: { hosts: ["api.example.com"], methods: ["GET"], paths: ["/v1/"] } } }), request: { url: "https://api.example.com/v1/anything", method: "GET" }, expect: ok() },

  // URL and method shape: 400 for malformed, 403 for not allowed.
  { name: "non-https protocol", policy, request: { url: "http://api.stripe.com/v1/charges", method: "GET" }, expect: no(403, "https") },
  { name: "custom port", policy, request: { url: "https://api.stripe.com:8443/v1/charges", method: "GET" }, expect: no(403, "port") },
  { name: "credentials in URL", policy, request: { url: "https://user:pass@api.stripe.com/v1/charges", method: "GET" }, expect: no(400, "credentials") },
  { name: "ip literal in URL", policy, request: { url: "https://192.0.2.1/v1/charges", method: "GET" }, expect: no(403, "ip literals") },
  { name: "ipv6 literal in URL", policy, request: { url: "https://[2001:db8::1]/v1/charges", method: "GET" }, expect: no(403, "ip literals") },
  { name: "localhost blocked", policy, request: { url: "https://localhost/v1/charges", method: "GET" }, expect: no(403, "localhost") },
  { name: "*.localhost blocked", policy, request: { url: "https://api.localhost/v1/charges", method: "GET" }, expect: no(403, "localhost") },
  { name: "*.local blocked", policy, request: { url: "https://api.local/v1/charges", method: "GET" }, expect: no(403, "localhost") },
  { name: "*.internal blocked", policy, request: { url: "https://api.internal/v1/charges", method: "GET" }, expect: no(403, "localhost") },
  { name: "unknown method", policy, request: { url: "https://api.stripe.com/v1/charges", method: "TRACE" }, expect: no(400, "method") },
  { name: "missing url", policy, request: { method: "GET" }, expect: no(400, "url") },
  { name: "missing method", policy, request: { url: "https://api.stripe.com/v1/charges" }, expect: no(400, "method") },

  // Headers: forbidden and placeholder in name refused.
  { name: "forbidden host header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { host: "evil.com" } }, expect: no(403, "host") },
  { name: "forbidden cookie header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { cookie: "a=b" } }, expect: no(403, "cookie") },
  { name: "forbidden content-length header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { "content-length": "0" } }, expect: no(403, "content-length") },
  { name: "forbidden proxy-* header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { "proxy-authorization": "x" } }, expect: no(403, "proxy-authorization") },
  { name: "forbidden x-forwarded-* header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { "x-forwarded-for": "1.2.3.4" } }, expect: no(403, "x-forwarded-for") },
  { name: "forbidden upgrade header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { upgrade: "websocket" } }, expect: no(403, "upgrade") },
  { name: "forbidden te header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { te: "trailers" } }, expect: no(403, "te") },
  { name: "forbidden trailer header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { trailer: "x" } }, expect: no(403, "trailer") },
  { name: "forbidden keep-alive header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { "keep-alive": "timeout=5" } }, expect: no(403, "keep-alive") },
  { name: "forbidden transfer-encoding header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { "transfer-encoding": "chunked" } }, expect: no(403, "transfer-encoding") },
  { name: "forbidden x-real-ip header", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { "x-real-ip": "1.2.3.4" } }, expect: no(403, "x-real-ip") },
  { name: "placeholder in header NAME", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { "{{secret:STRIPE_KEY}}": "x" } }, expect: no(403, "name placeholders") },
  { name: "non-string header value", policy, request: { url: "https://api.stripe.com/v1/charges", method: "GET", headers: { accept: 1 as unknown as string } }, expect: no(400, "value isn't a string") },
];

describe("planFetch", () => {
  for (const c of cases) {
    it(c.name, () => {
      const result = planFetch(c.policy ?? policy, c.request as Parameters<typeof planFetch>[1]);
      const expected = c.expect;
      if ("names" in expected) {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.method).toBe((c.request.method as string).toUpperCase());
          expect(result.names).toEqual(expected.names);
        }
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.status).toBe(expected.status);
          expect(result.error.toLowerCase()).toContain(expected.errorMatches.toLowerCase());
        }
      }
    });
  }

  it("uses the request url, not the policy's", () => {
    const result = planFetch(policy, { url: "https://api.stripe.com/v1/charges?x=1", method: "GET" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://api.stripe.com/v1/charges?x=1");
  });
});

describe("parsePolicy", () => {
  it("drops a malformed rule and lists it", () => {
    const parsed = parsePolicy({
      secrets: {
        GOOD: { hosts: ["api.example.com"], methods: ["GET"], paths: ["/"] },
        "1BAD": { hosts: ["api.example.com"], methods: ["GET"], paths: ["/"] },
        BAD_HOST: { hosts: ["*"], methods: ["GET"], paths: ["/"] },
        BAD_METHOD: { hosts: ["api.example.com"], methods: ["TRACE"], paths: ["/"] },
        BAD_PATH: { hosts: ["api.example.com"], methods: ["GET"], paths: ["nope"] },
      },
      public: ["SUPABASE_PUBLISHABLE_KEY", 42, "ok_name"],
    });
    expect(Object.keys(parsed.secrets)).toEqual(["GOOD"]);
    expect(parsed.public).toEqual(["SUPABASE_PUBLISHABLE_KEY", "ok_name"]);
    expect(parsed.problems.some((p) => p.includes("\"1BAD\""))).toBe(true);
    expect(parsed.problems.some((p) => p.includes("BAD_HOST"))).toBe(true);
    expect(parsed.problems.some((p) => p.includes("BAD_METHOD"))).toBe(true);
    expect(parsed.problems.some((p) => p.includes("BAD_PATH"))).toBe(true);
    expect(parsed.problems.some((p) => p.includes("public 42"))).toBe(true);
  });

  it("rejects IP, port, scheme and bare wildcard in host rules", () => {
    const parsed = parsePolicy({ secrets: { X: { hosts: ["192.168.0.1", "host:443", "https://example.com", "*", "example.com", "*.example.com", "localhost"], methods: ["GET"], paths: ["/"] } } });
    // Any invalid host drops the whole rule (we don't keep the valid names from a malformed
    // list — silent partial acceptance is a footgun), and lists each bad shape in problems.
    expect(parsed.secrets["X"]).toBeUndefined();
    expect(parsed.problems.some((p) => p.includes("192.168.0.1"))).toBe(true);
    expect(parsed.problems.some((p) => p.includes("host:443"))).toBe(true);
    expect(parsed.problems.some((p) => p.includes("https://example.com"))).toBe(true);
    expect(parsed.problems.some((p) => p.includes('"*"'))).toBe(true);
    expect(parsed.problems.some((p) => p.includes("localhost"))).toBe(true);
  });

  it("uppercases methods and dedups", () => {
    const parsed = parsePolicy({ secrets: { X: { hosts: ["example.com"], methods: ["get", "GET", "post"], paths: ["/"] } } });
    const rule = parsed.secrets["X"];
    expect(rule?.methods).toEqual(["GET", "POST"]);
  });

  it("defaults methods to GET and paths to /", () => {
    const parsed = parsePolicy({ secrets: { X: { hosts: ["example.com"] } } });
    const rule = parsed.secrets["X"];
    expect(rule?.methods).toEqual(["GET"]);
    expect(rule?.paths).toEqual(["/"]);
  });

  it("treats from: 'author' and from: 'viewer' as the two values, not 'user'", () => {
    const parsed = parsePolicy({ secrets: { A: { hosts: ["example.com"], from: "author" }, B: { hosts: ["example.com"], from: "viewer" }, C: { hosts: ["example.com"], from: "user" as "author" } } });
    expect(parsed.secrets["A"]?.from).toBe("author");
    expect(parsed.secrets["B"]?.from).toBe("viewer");
    expect(parsed.secrets["C"]).toBeUndefined();
  });

  it("accepts undefined secrets and public", () => {
    const parsed = parsePolicy({});
    expect(parsed).toEqual({ secrets: {}, public: [], problems: [] });
  });

  it("refuses a non-object secrets value", () => {
    const parsed = parsePolicy({ secrets: [] });
    expect(parsed.secrets).toEqual({});
    expect(parsed.problems[0] ?? "").toContain("secrets must be");
  });

  it("refuses a non-array methods / paths", () => {
    const parsed = parsePolicy({ secrets: { X: { hosts: ["example.com"], methods: "GET", paths: "x" } } });
    expect(parsed.secrets["X"]).toBeUndefined();
    // Methods is checked first; the bad path is never inspected.
    expect(parsed.problems.some((p) => p.includes("methods must be"))).toBe(true);
  });
});

describe("secretNames", () => {
  it("collects names from the URL, header values and body, deduplicated", () => {
    const names = secretNames({ url: "https://x/?a={{secret:A}}&b={{secret:B}}", method: "GET", headers: { authorization: "Bearer {{secret:A}}", "x-trace": "id-{{secret:C}}" }, body: "{{secret:B}} {{secret:C}}" });
    expect(names).toEqual(["A", "B", "C"]);
  });

  it("returns an empty list when there are no placeholders", () => {
    expect(secretNames({ url: "https://x/", method: "GET" })).toEqual([]);
  });
});

describe("isPrivateAddress", () => {
  // IPv4: each range the spec calls out has its own row.
  const ipv4 = [
    ["0.0.0.0", true],
    ["0.1.2.3", true],
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["100.64.0.1", true],
    ["100.127.255.255", true],
    ["100.63.0.1", false],
    ["127.0.0.1", true],
    ["127.42.42.42", true],
    ["169.254.0.1", true],
    ["169.254.169.254", true], // AWS metadata
    ["172.15.0.1", false],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["192.0.0.1", true],
    ["192.0.1.1", false],
    ["192.168.0.1", true],
    ["198.18.0.1", true],
    ["198.19.255.255", true],
    ["198.17.255.255", false],
    ["224.0.0.1", true],
    ["239.255.255.255", true],
    ["240.0.0.1", true],
    ["255.255.255.255", true],
    ["1.1.1.1", false],
    ["8.8.8.8", false],
  ] as const;
  for (const [ip, expectPrivate] of ipv4) {
    it(`v4 ${ip} → ${expectPrivate}`, () => {
      expect(isPrivateAddress(ip)).toBe(expectPrivate);
    });
  }

  // IPv6: loopback, link-local, unique-local, multicast, public.
  const ipv6 = [
    ["::", true],
    ["::1", true],
    ["::0.0.0.0", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:7f00:1", true],
    ["::ffff:1.1.1.1", false],
    ["fe80::1", true],
    ["febf::1", true],
    ["fc00::1", true],
    ["fd00::1", true],
    ["ff00::1", true],
    ["ff02::1", true],
    ["2001:db8::1", false],
    ["2606:4700:4700::1111", false],
  ] as const;
  for (const [ip, expectPrivate] of ipv6) {
    it(`v6 ${ip} → ${expectPrivate}`, () => {
      expect(isPrivateAddress(ip)).toBe(expectPrivate);
    });
  }

  it("rejects an out-of-range octet", () => {
    expect(isPrivateAddress("256.0.0.1")).toBe(true);
    expect(isPrivateAddress("-1.0.0.1")).toBe(true);
  });

  it("rejects a non-IP string", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("fillSecrets and maskSecrets", () => {
  it("replaces every placeholder in the URL, header values and body", () => {
    const filled = fillSecrets(
      { url: "https://x/?a={{secret:A}}", method: "GET", headers: { authorization: "Bearer {{secret:B}}", "x-trace": "{{secret:A}}" }, body: "{\"k\":\"{{secret:C}}\"}" },
      { A: "VA", B: "VB", C: "VC" },
    );
    expect(filled.url).toBe("https://x/?a=VA");
    expect(filled.headers).toEqual({ authorization: "Bearer VB", "x-trace": "VA" });
    expect(filled.body).toBe("{\"k\":\"VC\"}");
  });

  it("leaves a placeholder alone when its name isn't in values", () => {
    const filled = fillSecrets({ url: "https://x/?a={{secret:A}}", method: "GET" }, { B: "VB" });
    expect(filled.url).toBe("https://x/?a={{secret:A}}");
  });

  it("does not touch the headers object", () => {
    const headers = { authorization: "Bearer {{secret:A}}" };
    fillSecrets({ url: "https://x/", method: "GET", headers }, { A: "VA" });
    expect(headers.authorization).toBe("Bearer {{secret:A}}");
  });

  it("maskSecrets replaces every value with ‹NAME›", () => {
    expect(maskSecrets("hello VALUEA and VALUEB and VALUEA", { A: "VALUEA", B: "VALUEB" })).toBe("hello ‹A› and ‹B› and ‹A›");
  });

  it("maskSecrets leaves a value shorter than four characters alone", () => {
    expect(maskSecrets("VA and a", { A: "VA", a: "a" })).toBe("VA and a");
  });

  it("maskSecrets on utf8 body: a token that the server echoed is masked", () => {
    const text = '{"id":"ch_1","client_secret":"sk_live_SECRET123"}';
    const masked = maskSecrets(text, { STRIPE_KEY: "sk_live_SECRET123" });
    expect(masked).toBe('{"id":"ch_1","client_secret":"‹STRIPE_KEY›"}');
  });
});
