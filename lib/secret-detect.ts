// Pasted text that looks like a secret: an API key, a token, a private key, a database URL with a
// password, or a .env line. A thread keeps everything you send in its transcripts for good, so the
// Composer asks before pasting one (docs/architecture/secrets.md). Known key shapes only, plus .env
// lines with a secret-sounding name, so ordinary text and code don't trip it.

export interface SecretMatch {
  // What it looks like, for the warning: "a Stripe secret key".
  kind: string;
  // The start and end of the value with the middle hidden: "sk_live_51Hx…hJkL".
  preview: string;
}

const PATTERNS: [string, RegExp][] = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a Stripe secret key", /\b[sr]k_(live|test)_[0-9a-zA-Z]{16,}/],
  ["a Stripe webhook secret", /\bwhsec_[0-9a-zA-Z]{24,}/],
  ["a GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["an Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI API key", /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ["an AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["a Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["a Resend API key", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9_]{16,}/],
  ["a token (JWT)", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a database URL with a password", /\b(postgres(ql)?|mysql|mongodb(\+srv)?|rediss?|amqps?):\/\/[^:\s/@]+:[^@\s]{4,}@/],
];

// NAME=value where the name sounds secret and the value isn't a placeholder or a reference.
const ENV_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*["']?([^\s"'$<>{}]{8,})/m;
const PLACEHOLDER = /^(x{3,}|\*{3,}|\.{3,}|your|change|example|placeholder|replace|todo|dummy|fake|test-?key|secret$|process\.env)/i;

function mask(value: string): string {
  return value.length <= 12 ? `${value.slice(0, 2)}…` : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function findSecret(text: string): SecretMatch | null {
  for (const [kind, pattern] of PATTERNS) {
    const hit = pattern.exec(text);
    if (hit) return { kind, preview: kind === "a private key" ? "-----BEGIN … PRIVATE KEY-----" : mask(hit[0]) };
  }
  const [, name, value] = ENV_LINE.exec(text) ?? [];
  if (name && value && !PLACEHOLDER.test(value)) return { kind: `a secret (${name})`, preview: mask(value) };
  return null;
}
