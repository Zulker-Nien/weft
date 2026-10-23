import path from "node:path";
import { home, steps } from "./restart-guard";
import { parseShell } from "./shell-parse";

// The files a Bash command line says it writes, absolute: what `>` and `>>` send output into, and the file
// arguments of the commands that edit in place, copy over or delete (sed -i, perl -i, tee, cp, mv, rm, touch,
// prettier --write, eslint --fix). lib/bash-claims.ts asks before one of them is a file another busy card is
// editing. Only what the line names: what a script or codegen writes on its own shows up after the run instead,
// from git status.

const words = (args: string[]) => args.filter((a) => a !== "" && !a.startsWith("-"));

// The file arguments after a script given inline or as the first word: `sed -i 's/a/b/' f`, `perl -pi -e 's/a/b/' f`.
// A valued option's value is the inline script, so every other argument is a file; with no inline script the first
// plain argument is the script file instead (`sed -f fix.sed f`), unless an option already took a value, as in
// `sed -i -l a.txt`, where nothing is a script and `a.txt` is the file to edit.
function afterScript(args: string[], valued: Set<string>): string[] {
  const files: string[] = [];
  let inline = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (valued.has(a)) {
      inline = true;
      i++;
    } else if (a !== "" && !a.startsWith("-")) files.push(a);
  }
  return inline ? files : files.slice(1);
}

const SED_VALUED = new Set(["-e", "-f", "--expression", "--file", "-l"]);
const PERL_VALUED = new Set(["-e", "-E"]);
// eslint's options that take a value: `eslint --fix --ext .ts lib` edits lib, not a file called .ts.
const ESLINT_VALUED = new Set(["--ext", "--format", "--config", "--rulesdir", "--resolve-plugins-relative-to", "--plugin", "--rule"]);
const inPlace = (a: string) => a === "--in-place" || a.startsWith("--in-place=") || /^-[a-zA-Z]*i/.test(a);

// The plain file arguments, skipping the value after each of `valued`'s options.
function files(args: string[], valued: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a.startsWith("-")) {
      if (valued.has(a)) i++;
    } else if (a !== "") out.push(a);
  }
  return out;
}

const WRITERS: Record<string, (args: string[]) => string[]> = {
  sed: (args) => (args.some(inPlace) ? afterScript(args, SED_VALUED) : []),
  perl: (args) => (args.some((a) => /^-[a-zA-Z]*i/.test(a)) ? afterScript(args, PERL_VALUED) : []),
  tee: words,
  touch: words,
  rm: words,
  mv: words,
  cp: (args) => words(args).slice(-1),
  prettier: (args) => (args.includes("--write") || args.includes("-w") ? words(args) : []),
  eslint: (args) => (args.includes("--fix") ? files(args, ESLINT_VALUED) : []),
};

// `npx prettier …`, `pnpm exec eslint …`, `pnpm prettier …`: the tool they run.
const RUNNERS = new Set(["npx", "pnpx", "bunx", "pnpm", "yarn", "bun"]);

function unwrap(name: string, args: string[]): { name: string; args: string[] } {
  if (!RUNNERS.has(name)) return { name, args };
  const rest = ["exec", "dlx", "x"].includes(args[0] ?? "") ? args.slice(1) : args;
  const [first = "", ...more] = rest;
  return { name: path.basename(first), args: more };
}

const SHELLS = new Set("sh bash zsh dash ksh fish eval".split(" "));

// `cd lib && cat > a.ts`: each redirect's target, from the folder the command runs in — including inside
// `sh -c '…'`, a heredoc fed to bash and `$(…)`, the same scripts steps() walks into.
function redirects(command: string, cwd: string, depth = 0): string[] {
  if (depth > 5) return [];
  const { commands, nested } = parseShell(command);
  const out: string[] = [];
  let here = cwd;
  for (const c of commands) {
    const [name, ...args] = c.words;
    if (name === "cd") {
      here = path.resolve(here, home(args[0] ?? "~"));
      continue;
    }
    out.push(...c.outputs.map((o) => path.resolve(here, home(o))));
    const at = args.indexOf("-c");
    if (name && SHELLS.has(name)) {
      const scripts = name === "eval" ? [args.join(" ")] : [...c.stdin, ...(at >= 0 ? [args[at + 1] ?? ""] : [])];
      out.push(...scripts.flatMap((script) => redirects(script, here, depth + 1)));
    }
  }
  return [...out, ...nested.flatMap((n) => redirects(n, here, depth + 1))];
}

export function bashWrites(command: string, cwd: string): string[] {
  const named = steps(command, cwd).flatMap((s) => {
    const { name, args } = unwrap(s.name, s.args);
    return (WRITERS[name]?.(args) ?? []).map((f) => path.resolve(s.cwd, home(f)));
  });
  return [...new Set([...redirects(command, cwd), ...named])].filter((f) => !f.startsWith("/dev/"));
}
