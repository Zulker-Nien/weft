// Claude Code PostToolUse hook (.claude/settings.json): after an Edit or Write in this repo, tells the
// session about any import the edit broke (lib/import-check.ts), before the dev server shows it as a build
// error over the board. Board threads get the same check in-process (lib/env.ts guardedCli), so it skips
// them. Exit 2 hands the report back to the agent; anything going wrong here never gets in an edit's way.
import path from "node:path";

if (process.env.CLAUDE_CODE_ENTRYPOINT === "sdk-ts") process.exit(0);

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

try {
  const { tool_input: input, cwd } = JSON.parse(raw);
  const file = input?.file_path;
  if (typeof file === "string") {
    const { brokenImports, importReport } = await import("../lib/import-check.ts");
    const problems = brokenImports(path.resolve(cwd ?? ".", file));
    if (problems.length) {
      process.stderr.write(`${importReport(problems)}\n`);
      process.exit(2);
    }
  }
} catch {
  // A malformed payload or a Node without type stripping: say nothing.
}
