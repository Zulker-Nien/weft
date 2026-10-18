import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { captureAiGeneration } from "./ai-observability";
import { projectRoot } from "./quality";
import { MAX_FINDINGS, parseFindings, type ScoutReport, type ScoutState } from "./scout-view";
import { SECRET_GUARD_HOOKS } from "./secret-guard";
import { DATA_DIR } from "./store";

// The refactor scout: a read-only Sonnet run that reads a project and lists concrete improvements the
// checklist in lib/quality.ts can't see. Cached per project with the commit it ran on. It runs on its own
// only for a project with no report yet; after that, /weft:done's scout (scout-save.mjs) and "Re-scout"
// refresh it. Never on the start-a-card path (SOUL.md: speed first), and never just because HEAD moved.

const DIR = path.join(DATA_DIR, "scout");
const MAX_TURNS = 40;

const running = new Map<string, Promise<void>>();
const errors = new Map<string, string>();

export function scoutFile(root: string) {
  return path.join(DIR, `${createHash("sha1").update(root).digest("hex").slice(0, 16)}.json`);
}

export function headCommit(root: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function readScout(root: string): ScoutReport | null {
  try {
    return JSON.parse(fs.readFileSync(scoutFile(root), "utf8")) as ScoutReport;
  } catch {
    return null;
  }
}

function writeScout(report: ScoutReport) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(scoutFile(report.root), JSON.stringify(report, null, 2));
}

export function scoutPrompt() {
  return `You are a refactor scout. Read this project (use Glob, Grep and Read; start from the largest and most-imported source files, skip tests, generated files and dependencies) and find the most valuable concrete improvements. Up to ${String(MAX_FINDINGS)}, best first, across these categories:

- refactor: a code smell named the way Martin Fowler's Refactoring (2nd ed.) names it: Long Function, Large Class, Duplicated Code, Feature Envy, Primitive Obsession, Data Clumps, Long Parameter List, Shotgun Surgery, Divergent Change, Message Chains, Speculative Generality, Mysterious Name, Global Data, Repeated Switches, Temporary Field.
- lint: a lint rule that isn't on yet and would catch something real here (read the lint config first; name the rule and where it would fire).
- types: type looseness: a wide \`string\` or \`number\` where a union of literals fits, \`as\` casts, \`any\`, non-null \`!\`, optional fields that are always set, or a missing return type on an exported function.
- tests: an important behaviour with no test, or a test that checks nothing.
- guardrails: a missing check in the pre-commit hook or CI.

Each finding must point at a real file and line you read. Be concrete: no generic advice, nothing you didn't see. Always find something: there is always another refactor, a stricter rule or a better type.

Reply with only a JSON array, no prose:
[{"file": "lib/x.ts", "line": 42, "smell": "Long Function", "category": "refactor", "severity": "high", "fix": "Extract the retry loop into retryWithBackoff()"}]
severity is high, medium or low; fix is one short sentence, under 120 characters.`;
}

async function scout(root: string) {
  let text = "";
  const prompt = scoutPrompt();
  const traceId = randomUUID();
  const startedAt = Date.now();
  for await (const msg of query({
    prompt,
    options: {
      model: "sonnet",
      cwd: root,
      tools: ["Read", "Grep", "Glob"],
      allowedTools: ["Read", "Grep", "Glob"],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      // It reads the whole project, .env files included unless turned away.
      hooks: SECRET_GUARD_HOOKS,
      maxTurns: MAX_TURNS,
    },
  })) {
    if (msg.type !== "result") continue;
    await captureAiGeneration({
      sessionId: null,
      traceId,
      spanName: "refactor_scout",
      model: "sonnet",
      input: prompt,
      output: msg.subtype === "success" ? msg.result : undefined,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      cacheReadInputTokens: msg.usage.cache_read_input_tokens,
      cacheCreationInputTokens: msg.usage.cache_creation_input_tokens,
      latencyMs: Date.now() - startedAt,
      isError: msg.subtype !== "success",
      error: msg.subtype !== "success" ? msg.subtype : undefined,
      stream: true,
    });
    if (msg.subtype !== "success") throw new Error(`The scout stopped: ${msg.subtype}`);
    text = msg.result;
  }
  const findings = parseFindings(text);
  if (!findings.length) throw new Error("The scout returned no findings");
  const previous = readScout(root);
  const ids = new Set(findings.map((f) => f.id));
  writeScout({
    root,
    commit: headCommit(root),
    ranAt: Date.now(),
    findings,
    // A finding handed to a card stays marked while the scout still sees it.
    started: (previous?.started ?? []).filter((id) => ids.has(id)),
  });
}

// Starts a run for the project unless one is going. Resolves when it ends; never rejects.
export function startScout(root: string): Promise<void> {
  const going = running.get(root);
  if (going) return going;
  errors.delete(root);
  const run = scout(root)
    .catch((err: unknown) => {
      errors.set(root, err instanceof Error ? err.message : String(err));
    })
    .finally(() => running.delete(root));
  running.set(root, run);
  return run;
}

// The badge's read: the cached report, starting a run in the background when there's none yet or it's asked for.
export function scoutState(cwd: string, { force = false } = {}): ScoutState {
  const root = projectRoot(cwd);
  const report = readScout(root);
  if (force || (!report && !errors.has(root))) void startScout(root);
  const error = errors.get(root);
  return { report, running: running.has(root), ...(error ? { error } : {}) };
}

// Marks a finding as handed to a card.
export function markStarted(cwd: string, id: string) {
  const report = readScout(projectRoot(cwd));
  if (report && !report.started.includes(id)) writeScout({ ...report, started: [...report.started, id] });
}
