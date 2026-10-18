import { describe, expect, it } from "vitest";
import { copyFor, leagueMailHtml, leagueMailText, type Links, type MailCopy } from "./league-mail-copy";
import type { LeagueFacts, LeagueMail, ResultFacts, Standing, StandingFacts } from "./league-mail";

const LINKS: Links = { open: "https://weft.zip/api/league/open", unsubscribe: "https://weft.zip/api/league/unsubscribe?u=a&t=abc", origin: "https://weft.zip" };

const top = (...names: string[]): Standing[] => names.map((n, i) => ({ rank: i + 1, name: n, xp: 100 - i * 10, isMe: n === "Alex" }));

const facts = (over: Partial<LeagueFacts> = {}): LeagueFacts => ({
  name: "Alex",
  league: "Cotton",
  week: "2026-10-12",
  rank: 1,
  size: 30,
  xp: 100,
  up: 7,
  down: 5,
  daysLeft: 4,
  top: top("Alex", "Bo", "Cy"),
  ...over,
});

const standing = (over: Partial<StandingFacts> = {}): StandingFacts => ({
  ...facts(over),
  zone: "up",
  gap: 0,
  lead: 10,
  ...over,
});

const result = (over: Partial<ResultFacts> = {}): ResultFacts => ({
  ...facts(over),
  shipped: 3,
  move: "up",
  next: "Linen",
  ...over,
});

describe("copyFor", () => {
  it("returns the welcome copy for a welcome mail, with a solo or full-league preheader", () => {
    const solo: LeagueMail = { kind: "welcome", userId: "a", to: "a@w.test", week: "2026-10-12", facts: facts({ size: 1, daysLeft: 4, top: [{ rank: 1, name: "Alex", xp: 0, isMe: true }] }) };
    const copy = copyFor(solo);
    expect(copy.subject).toBe("Welcome to the Cotton league");
    expect(copy.preheader).toMatch(/today's the last day|days left/);
    expect(copy.heading).toBe("You're in Cotton");
    expect(copy.tableTitle).toBe("Cotton this week");
    expect(copy.eyebrow).toBe("Your league");
    expect(copy.table).toEqual([{ rank: 1, name: "Alex", xp: 0, isMe: true }]);

    // Full league, daysLeft 1.
    const full: LeagueMail = { kind: "welcome", userId: "a", to: "a@w.test", week: "2026-10-12", facts: facts({ size: 30, daysLeft: 1, rank: 5 }) };
    const fullCopy = copyFor(full);
    expect(fullCopy.preheader).toBe("You're one of 30 builders this week; today's the last day.");
  });

  it("returns the up-zone standing copy, with lead in the preheader paragraph", () => {
    const mail: LeagueMail = { kind: "midweek", userId: "a", to: "a@w.test", week: "2026-10-12", facts: standing({ zone: "up", rank: 1, lead: 0, daysLeft: 4 }) };
    const copy = copyFor(mail);
    expect(copy.subject).toBe("You're #1 in Cotton, in the move-up zone");
    expect(copy.heading).toBe("#1 of 30: you're moving up");
    expect(copy.paragraphs[0]).toContain("100 XP this week");
    expect(copy.paragraphs[0]).toContain("Cotton");
    expect(copy.tableTitle).toBe("Cotton right now");
    expect(copy.eyebrow).toBe("Midweek standing");

    // With a lead, the paragraph mentions it.
    const withLead = copyFor({ ...mail, facts: standing({ lead: 30 }) });
    expect(withLead.paragraphs[0]).toContain("30 XP ahead of the first builder outside it");

    // Sunday's final up-zone: subject is prefixed with "Last day: " and uses lowercase "you're".
    const final: LeagueMail = { kind: "final", userId: "a", to: "a@w.test", week: "2026-10-12", facts: standing({ zone: "up", rank: 1, lead: 0, daysLeft: 1 }) };
    const finalCopy = copyFor(final);
    expect(finalCopy.subject).toBe("Last day: you're #1 in Cotton, in the move-up zone");
    expect(finalCopy.eyebrow).toBe("Last day of the week");
  });

  it("returns the down-zone standing copy, with the gap to escape", () => {
    const mail: LeagueMail = { kind: "final", userId: "a", to: "a@w.test", week: "2026-10-12", facts: standing({ zone: "down", rank: 28, size: 30, gap: 30, lead: 0, daysLeft: 1 }) };
    const copy = copyFor(mail);
    expect(copy.subject).toBe("Last day: 30 XP keeps you in Cotton");
    expect(copy.preheader).toContain("in the bottom 5");
    expect(copy.heading).toBe("30 XP to stay in Cotton");
    expect(copy.paragraphs[0]).toContain("bottom 5");
    expect(copy.eyebrow).toBe("Last day of the week");
    expect(copy.tableTitle).toBe("Cotton right now");
  });

  it("returns the within-reach standing copy, with the gap to the up zone", () => {
    const mail: LeagueMail = { kind: "midweek", userId: "a", to: "a@w.test", week: "2026-10-12", facts: standing({ zone: null, rank: 8, size: 30, gap: 3, lead: 0, daysLeft: 4 }) };
    const copy = copyFor(mail);
    expect(copy.subject).toBe("3 XP from moving up");
    expect(copy.heading).toBe("3 XP from the top 7");
    expect(copy.paragraphs[0]).toContain("The top 7 move up");
    expect(copy.paragraphs[1]).toContain("3 XP in the 4 days left");
  });

  it("returns the up, down and stay results copies, with the next league name and shipped cards", () => {
    const up: LeagueMail = { kind: "results", userId: "a", to: "a@w.test", week: "2026-10-12", facts: result({ move: "up", next: "Linen", rank: 1, size: 30, xp: 100, shipped: 3 }) };
    const upCopy = copyFor(up);
    expect(upCopy.subject).toBe("You moved up to Linen");
    expect(upCopy.heading).toBe("Welcome to Linen");
    expect(upCopy.preheader).toBe("You finished #1 of 30 with 100 XP and 3 cards shipped.");
    expect(upCopy.eyebrow).toBe("Last week's results");
    expect(upCopy.tableTitle).toBe("Cotton, final");
    expect(upCopy.table).toHaveLength(3);

    const down: LeagueMail = { kind: "results", userId: "a", to: "a@w.test", week: "2026-10-12", facts: result({ move: "down", next: "Cotton", rank: 30, size: 30, xp: 0, shipped: 0 }) };
    const downCopy = copyFor(down);
    expect(downCopy.subject).toBe("You moved down to Cotton");
    expect(downCopy.heading).toBe("This week: Cotton");
    expect(downCopy.paragraphs[0]).toContain("after a quiet week");

    // A down move with some XP: the effort is the week line, not "a quiet week".
    const downWithXp: LeagueMail = { kind: "results", userId: "a", to: "a@w.test", week: "2026-10-12", facts: result({ move: "down", next: "Cotton", rank: 30, size: 30, xp: 50, shipped: 1 }) };
    expect(copyFor(downWithXp).paragraphs[0]).toContain("after #30 of 30 with 50 XP and 1 card shipped");
    expect(copyFor(downWithXp).paragraphs[0]).not.toContain("quiet week");

    const stay: LeagueMail = { kind: "results", userId: "a", to: "a@w.test", week: "2026-10-12", facts: result({ move: "stay", next: "Cotton", rank: 5, size: 30, xp: 50, shipped: 2 }) };
    const stayCopy = copyFor(stay);
    expect(stayCopy.subject).toBe("You held your place in Cotton");
    expect(stayCopy.heading).toBe("#5 of 30 in Cotton");
    expect(stayCopy.paragraphs[1]).toContain("fresh league with everyone at 0 XP");
  });
});

describe("leagueMailHtml", () => {
  const copy: MailCopy = {
    subject: "Welcome to the Cotton league",
    preheader: "You're in.",
    heading: "You're in Cotton",
    eyebrow: "Your league",
    paragraphs: ["Hi Alex, welcome.", "Ship a card today and you're on the board."],
    tableTitle: "Cotton this week",
    table: [
      { rank: 1, name: "Alex", xp: 100, isMe: true },
      { rank: 2, name: "Bo & Cy <script>", xp: 50, isMe: false },
    ],
  };

  it("renders the subject, preheader, heading, table and CTA, escaping names and links", () => {
    const html = leagueMailHtml(copy, LINKS);
    expect(html).toContain("Welcome to the Cotton league");
    expect(html).toContain("You're in.");
    expect(html).toContain("You're in Cotton");
    expect(html).toContain("Hi Alex, welcome.");
    expect(html).toContain("Ship a card today");
    expect(html).toContain("Open your league");
    expect(html).toContain("Cotton this week");
    expect(html).toMatch(/<td[^>]*>\s*Alex\s*\(you\)\s*<\/td>/);
    expect(html).toContain("Bo &amp; Cy &lt;script&gt;");
    expect(html).toContain("Stop league emails");
    expect(html).toContain("weft.zip");
  });

  it("escapes ampersands, angle brackets and quotes in subject, link and origin", () => {
    const tricky: MailCopy = { ...copy, subject: `Hi & <x>`, heading: `Q: "x"` };
    const links: Links = { open: "https://w.test/?a=1&b=2", unsubscribe: "https://w.test/u?t=\"x\"", origin: "https://w.test" };
    const html = leagueMailHtml(tricky, links);
    expect(html).toContain("Hi &amp; &lt;x&gt;");
    expect(html).toContain("https://w.test/?a=1&amp;b=2");
    expect(html).toContain("t=&quot;x&quot;");
  });

  it("does not render the standings table when the copy has none", () => {
    const noTable: MailCopy = { ...copy, table: [], tableTitle: "Hidden" };
    const html = leagueMailHtml(noTable, LINKS);
    expect(html).not.toContain("Hidden");
    // The standings table starts with the uppercase title <p>; the wrapper tables have lowercase "presentation".
    expect(html).not.toMatch(/border-collapse:separate/);
  });
});

describe("leagueMailText", () => {
  it("writes the heading, paragraphs, a numbered table with the (you) marker, and the links", () => {
    const copy: MailCopy = {
      subject: "Welcome to the Cotton league",
      preheader: "You're in.",
      heading: "You're in Cotton",
      eyebrow: "Your league",
      paragraphs: ["Hi Alex.", "Ship a card today."],
      tableTitle: "Cotton this week",
      table: [
        { rank: 1, name: "Alex", xp: 100, isMe: true },
        { rank: 2, name: "Bo", xp: 50, isMe: false },
      ],
    };
    const text = leagueMailText(copy, LINKS);
    expect(text).toContain("You're in Cotton");
    expect(text).toContain("Hi Alex.");
    expect(text).toContain("Ship a card today.");
    expect(text).toContain("Cotton this week:");
    expect(text).toContain("#1  Alex (you)  100 XP");
    expect(text).toContain("#2  Bo  50 XP");
    expect(text).toContain("Open your league: https://weft.zip/api/league/open");
    expect(text).toContain("Stop league emails: https://weft.zip/api/league/unsubscribe?u=a&t=abc");
  });

  it("skips the table block when there is no table", () => {
    const copy: MailCopy = {
      subject: "x", preheader: "x", heading: "h", eyebrow: "e", paragraphs: ["p"], tableTitle: "t", table: [],
    };
    const text = leagueMailText(copy, LINKS);
    expect(text).not.toContain("t:");
    expect(text).toContain("Open your league:");
  });
});

describe("rules pluralisation", () => {
  it("says the bottom down when f.down is positive", () => {
    // The "rules" helper's branch shows when f.down > 0; exercise via a welcome copy.
    const mail: LeagueMail = { kind: "welcome", userId: "a", to: "a@w.test", week: "2026-10-12", facts: facts({ size: 30, down: 5, daysLeft: 4 }) };
    expect(copyFor(mail).paragraphs[1]).toContain("the bottom 5 move down");
  });

  it("omits the down clause when f.down is zero", () => {
    // Size 2: up=1, down=0.
    const mail: LeagueMail = { kind: "welcome", userId: "a", to: "a@w.test", week: "2026-10-12", facts: facts({ size: 2, down: 0, up: 1, daysLeft: 4 }) };
    expect(copyFor(mail).paragraphs[1]).toContain("Every Monday the top 1 move up a league.");
    expect(copyFor(mail).paragraphs[1]).not.toContain("move down");
  });
});
