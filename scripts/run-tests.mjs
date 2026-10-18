// `pnpm test` and `pnpm coverage`: vitest, with whole-suite runs taking turns across cards. Each full run starts
// a worker per core, so three cards testing at once ran 27 workers on 8 cores. A run of named files
// (`pnpm test lib/x.test.ts`) is quick and goes straight through. Either way a signal that stops this script
// reaches vitest too (scripts/one-at-a-time.mjs runHolding). Usage: node scripts/run-tests.mjs [vitest args...]
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runHolding } from "./one-at-a-time.mjs";

// Flags whose value is the next argument, so that argument isn't a file filter.
const TAKES_VALUE = new Set(["-t", "--testNamePattern", "--reporter", "--project", "--pool", "--shard", "--maxWorkers", "--config", "-c", "--root", "-r", "--environment"]);

// True when the args name files or folders to run, i.e. not the whole suite.
export function isFiltered(args) {
  return args.some((arg, i) => !arg.startsWith("-") && arg !== "run" && !TAKES_VALUE.has(args[i - 1] ?? ""));
}

// Vitest 4 exports only its package.json, so its bin is found beside that.
function vitestBin() {
  return path.join(path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
}

export async function main(args) {
  const vitest = [vitestBin(), "run", ...args];
  if (!isFiltered(args)) return runHolding("test", process.execPath, { args: vitest });
  const child = spawn(process.execPath, vitest, { stdio: "inherit" });
  const forward = (signal) => child.kill(signal);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, forward);
  return new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
