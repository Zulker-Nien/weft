// The builder card: eight attributes (0-100) worked out from what you build and how, the class your
// top two make, and a level per technology from the cards you shipped with it. Pure (see lib/game.ts).
import { addDays, XP, type ActivityEvent, type DayTally } from "./game";
import { isRefactor } from "./game-badges";
import { branchProgress, type ProjectReport } from "./project-badges";

export type AttributeId = "follow" | "velocity" | "range" | "rigor" | "guard" | "craft" | "stamina" | "thrift";

export interface Attribute {
  id: AttributeId;
  icon: string;
  label: string;
  value: number;
  // How it's measured, with your number.
  hint: string;
}

// Each attribute names the class when it's your best, and its adjective when it's your second best.
const META: Record<AttributeId, { icon: string; label: string; noun: string; adjective: string }> = {
  follow: { icon: "🎯", label: "Follow-through", noun: "Finisher", adjective: "Reliable" },
  velocity: { icon: "⚡", label: "Velocity", noun: "Shipper", adjective: "Swift" },
  range: { icon: "🧭", label: "Range", noun: "Explorer", adjective: "Roaming" },
  rigor: { icon: "🧪", label: "Rigor", noun: "Artisan", adjective: "Rigorous" },
  guard: { icon: "🛡️", label: "Guard", noun: "Guardian", adjective: "Vigilant" },
  craft: { icon: "🧹", label: "Craft", noun: "Refiner", adjective: "Careful" },
  stamina: { icon: "🔥", label: "Stamina", noun: "Marathoner", adjective: "Tireless" },
  thrift: { icon: "💰", label: "Thrift", noun: "Tinkerer", adjective: "Frugal" },
};

export interface AttributeInput {
  events: ActivityEvent[];
  days: Map<string, DayTally>;
  today: string;
  bestStreak: number;
  projects: ProjectReport[];
  // Projects with 3 or more cards, and every stack seen across them.
  projectCount: number;
  stacks: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

function lastDays(days: Map<string, DayTally>, today: string, n: number) {
  const from = addDays(today, -(n - 1));
  return [...days].filter(([day]) => day >= from && day <= today).map(([, d]) => d);
}

// Cost per shipped card: $0.10 or less is 100, $5 or more is 0, on a log scale.
export function thriftScore(costPerCard: number | null): number {
  if (costPerCard === null) return 50;
  return clamp(100 - (Math.log10(Math.max(costPerCard, 0.1) / 0.1) / Math.log10(50)) * 100);
}

function treeShare(projects: ProjectReport[], branches: Parameters<typeof branchProgress>[1][]) {
  return avg(
    projects.map((p) => {
      const parts = branches.map((b) => branchProgress(p, b));
      return (100 * parts.reduce((n, x) => n + x.done, 0)) / parts.reduce((n, x) => n + x.total, 0);
    }),
  );
}

export function attributes(input: AttributeInput): Attribute[] {
  const { events, days, today } = input;
  const created = new Set(events.filter((e) => e.kind === "created").map((e) => e.card)).size;
  const done = events.filter((e) => e.kind === "done");
  const month = lastDays(days, today, 30);
  const activeMonth = month.filter((d) => d.cards + d.turns + d.done > 0).length;
  const shippedMonth = month.reduce((n, d) => n + d.done, 0);
  const perDay = activeMonth ? shippedMonth / activeMonth : 0;
  const paid = done.filter((e) => (e.cost ?? 0) > 0);
  const costPerCard = paid.length ? paid.reduce((n, e) => n + (e.cost ?? 0), 0) / paid.length : null;
  const refactors = done.filter((e) => isRefactor(e.title)).length;
  const values: Record<AttributeId, [number, string]> = {
    follow: [created ? (100 * done.length) / created : 0, `${done.length} of ${created} cards reached Done`],
    velocity: [perDay * 10, `${perDay.toFixed(1)} cards shipped per active day this month`],
    range: [input.projectCount * 6 + input.stacks * 3, `${input.projectCount} projects, ${input.stacks} technologies`],
    rigor: [treeShare(input.projects, ["testing"]), "Testing checks passed across your projects"],
    guard: [treeShare(input.projects, ["security", "observability"]), "Security and observability checks passed"],
    craft: [done.length ? (400 * refactors) / done.length : 0, `${refactors} refactor cards shipped`],
    stamina: [(activeMonth / 30) * 80 + Math.min(20, input.bestStreak), `${activeMonth} active days this month, best streak ${input.bestStreak}`],
    thrift: [thriftScore(costPerCard), costPerCard === null ? "No costs recorded yet" : `$${costPerCard.toFixed(2)} per shipped card`],
  };
  return (Object.keys(META) as AttributeId[]).map((id) => ({
    id,
    icon: META[id].icon,
    label: META[id].label,
    value: clamp(values[id][0]),
    hint: values[id][1],
  }));
}

// "Swift Finisher": your best attribute's noun, after your second best's adjective.
export function classFor(attrs: Attribute[]): string {
  const [top, second] = [...attrs].sort((a, b) => b.value - a.value);
  if (!top) return "Apprentice";
  return second ? `${META[second.id].adjective} ${META[top.id].noun}` : META[top.id].noun;
}

export interface Skill {
  tech: string;
  xp: number;
  level: number;
}

// Every shipped card gives its XP to each technology its project uses.
export function stackSkills(events: ActivityEvent[], stackOf: (cwd: string) => string[]): Skill[] {
  const xp = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "done" || !e.cwd) continue;
    for (const tech of stackOf(e.cwd)) xp.set(tech, (xp.get(tech) ?? 0) + XP.done);
  }
  return [...xp]
    .map(([tech, n]) => ({ tech, xp: n, level: Math.floor(Math.sqrt(n / 10)) }))
    .sort((a, b) => b.xp - a.xp);
}
