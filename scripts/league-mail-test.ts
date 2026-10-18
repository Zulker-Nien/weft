import { leagueName } from "../lib/league";
import type { LeagueMail, Standing } from "../lib/league-mail";
import { outgoing, resendSender } from "../lib/league-mail-send";

// Sends one sample league email to an address, to see how it looks in a real inbox:
//   pnpm league:test-mail you@example.com [welcome|midweek|final|results] [--dry]
// Needs RESEND_API_KEY (run it through the 🔐 vault); LEAGUE_EMAIL_SECRET signs the unsubscribe link when present.
// --dry prints the subject and text instead of sending.

const [to, kind = "midweek", flag] = process.argv.slice(2);
if (!to?.includes("@")) {
  console.error("Usage: pnpm league:test-mail you@example.com [welcome|midweek|final|results] [--dry]");
  process.exit(1);
}

const top: Standing[] = [
  { rank: 1, name: "Ada", xp: 940, isMe: false },
  { rank: 2, name: "Linus", xp: 810, isMe: false },
  { rank: 3, name: "You", xp: 760, isMe: true },
  { rank: 4, name: "Grace", xp: 700, isMe: false },
  { rank: 5, name: "Ken", xp: 655, isMe: false },
];
const base = { name: "Alex", league: leagueName(2), week: "2026-W43", rank: 3, size: 30, xp: 760, up: 7, down: 5, daysLeft: 4, top };
const head = { userId: "test-user", to, week: base.week };

const mails: Record<string, LeagueMail> = {
  welcome: { kind: "welcome", ...head, facts: base },
  midweek: { kind: "midweek", ...head, facts: { ...base, zone: "up", gap: 0, lead: 60 } },
  final: { kind: "final", ...head, facts: { ...base, daysLeft: 1, zone: "up", gap: 0, lead: 60 } },
  results: { kind: "results", ...head, facts: { ...base, daysLeft: 0, shipped: 14, move: "up", next: leagueName(3) } },
};
const mail = mails[kind];
if (!mail) {
  console.error(`Unknown kind "${kind}"; use welcome, midweek, final or results.`);
  process.exit(1);
}

const out = outgoing(mail, "https://weft.zip", process.env.LEAGUE_EMAIL_SECRET || "test-secret");
out.subject = `[Test] ${out.subject}`;
if (flag === "--dry") {
  console.log(`To: ${out.to}\nSubject: ${out.subject}\n\n${out.text}`);
} else {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("RESEND_API_KEY is not set.");
    process.exit(1);
  }
  await resendSender(key)(out);
  console.log(`Sent "${out.subject}" to ${out.to}`);
}
