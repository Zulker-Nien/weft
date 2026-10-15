// Claude Code hook (.claude/settings.json) for sessions outside Weft; board threads get the same checks
// in-process (lib/env.ts guardedCli), so it skips them. Anything going wrong here never gets in an edit's way.
// - PreToolUse: refuses an edit that makes a route file (app/**/page.tsx, a layout, a route.ts…) import a
//   module that isn't there yet, which would take the whole app down (lib/route-import-guard.ts), and Bash
//   running tsc or eslint directly instead of the pnpm scripts that take turns (lib/check-guard.ts).
// - PostToolUse: after an Edit or Write, tells the session about any import the edit broke
//   (lib/import-check.ts), before the dev server shows it as a build error over the board.
// Exit 2 hands the reason back to the agent (and, before the tool runs, stops it).
import { registerHooks } from "node:module";
import path from "node:path";

if (process.env.CLAUDE_CODE_ENTRYPOINT === "sdk-ts") process.exit(0);

// lib/ imports its neighbours without an extension (the bundler's way); Node's type stripping needs ".ts".
registerHooks({
  resolve(spec, context, next) {
    try {
      return next(spec, context);
    } catch (err) {
      if (spec.startsWith(".")) return next(`${spec}.ts`, context);
      throw err;
    }
  },
});

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

try {
  const { hook_event_name: event, tool_name: tool, tool_input: input, cwd } = JSON.parse(raw);
  const file = input?.file_path;
  if (event === "PreToolUse" && tool === "Bash") {
    const { checkVerdict } = await import("../lib/check-guard.ts");
    const why = typeof input?.command === "string" ? checkVerdict(input.command, cwd ?? ".") : null;
    if (why) {
      process.stderr.write(`${why}\n`);
      process.exit(2);
    }
  } else if (event === "PreToolUse") {
    const { routeImportCheck } = await import("../lib/route-import-guard.ts");
    const why = routeImportCheck(tool, input, cwd ?? ".");
    if (why) {
      process.stderr.write(`${why}\n`);
      process.exit(2);
    }
  } else if (typeof file === "string") {
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
