import path from "node:path";
import type { HookCallback, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { blankCommand, parseShell, type SimpleCommand } from "./shell-parse";
import { DATA_DIR } from "./store";

// Threads see a secret's name, never its value (docs/architecture/secrets.md): once a value is in a
// thread's context it's in the model request and the transcripts on disk for good. This PreToolUse
// hook turns away the obvious ways a thread reads one: a .env file, Weft's own sign-in token, or a dump
// of the environment. A hook, not canUseTool, because canUseTool only hears about tools that would ask
// you; reads are allowed without asking, and bypassPermissions skips it entirely.
// It's a strong default, not a sandbox: a script that reads the file itself still can.

// .env, .env.local, .env.production.local, direnv's .envrc, Wrangler's .dev.vars, and globs like .env*.
// Any case: macOS opens .ENV.LOCAL as .env.local.
const SECRET_FILE = /^(\.env([.*?[].*)?|\.envrc|\.dev\.vars)$/i;
// Files that list names with placeholder values.
const TEMPLATE = /\.(example|sample|template|dist|defaults)$/i;
// Weft's own files in the data dir: the sign-in token, the device key, the vault (ciphertext, but
// threads have no reason to read it) and the sealed Vercel token.
const DATA_SECRET = /^(account\.json|device-key\.json|vercel-token\.json|vault(\/.*)?)$/i;
// A process's environment, on Linux.
const PROC_ENV = /^\/proc\/[^/]+\/environ$/;
// What a glob like `.e*` or `account*` is tried against.
const SECRET_NAMES = [".env", ".env.local", ".env.development.local", ".env.production", ".env.production.local", ".envrc", ".dev.vars"];
const DATA_NAMES = ["account.json", "device-key.json", "vercel-token.json", "vault"];

// A glob as a regex. As in the shell, a leading * or ? skips dotfiles unless dotGlob (ripgrep's globs don't).
function globRegex(glob: string, dotGlob: boolean): RegExp {
  const body = glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\[!/g, "[^");
  try {
    return new RegExp(`^${dotGlob || glob.startsWith(".") ? "" : "(?!\\.)"}${body}$`, "i");
  } catch {
    return /$^/;
  }
}

// Brace expansion multiplies: a heredoc of code with 25 `{a, b}` groups is 2^25 words, which froze the
// board's server for good (2026-10-12). Past this many words, the glob's pieces are checked one by one.
const MAX_EXPANSIONS = 256;
const GROUP = /\{([^{}]*)\}/g;

const alternatives = (group: RegExpExecArray) => (group[1] ?? "").split(",");

// One word with all its innermost groups expanded in one pass, so a script's many `{ ... }` blocks cost one copy.
function expandGroups({ word, groups }: { word: string; groups: RegExpExecArray[] }): string[] {
  let heads = [""];
  let at = 0;
  for (const m of groups) {
    const before = word.slice(at, m.index);
    heads = heads.flatMap((head) => alternatives(m).map((alt) => head + before + alt));
    at = m.index + m[0].length;
  }
  return heads.map((head) => head + word.slice(at));
}

// `{.env,.env.local}` as each name it stands for.
function expandBraces(glob: string): string[] {
  let words = [glob];
  for (;;) {
    const found = words.map((word) => ({ word, groups: [...word.matchAll(GROUP)] }));
    if (found.every((f) => f.groups.length === 0)) return words;
    const total = found.reduce((n, f) => n + f.groups.reduce((k, m) => k * alternatives(m).length, 1), 0);
    if (total > MAX_EXPANSIONS) return glob.split(/[\s{},]+/).filter(Boolean);
    words = found.flatMap(expandGroups);
  }
}

// The name itself, or a glob that reaches one of the known names.
function matchesName(name: string, pattern: RegExp, names: string[], dotGlob: boolean): boolean {
  if (pattern.test(name)) return true;
  if (!/[*?[]/.test(name)) return false;
  const glob = globRegex(name, dotGlob);
  return names.some((n) => glob.test(n));
}

export function isSecretFile(file: string, dataDir = DATA_DIR, dotGlob = false): boolean {
  const clean = file.replace(/^["']|["']$/g, "");
  if (PROC_ENV.test(clean)) return true;
  const inWeft = /\/\.weft\/(.+)$/i.exec(clean)?.[1];
  const inData = path.relative(dataDir, path.resolve(clean));
  if ([inWeft, inData].some((p) => p && matchesName(p, DATA_SECRET, DATA_NAMES, dotGlob))) return true;
  const base = path.basename(clean);
  return matchesName(base, SECRET_FILE, SECRET_NAMES, dotGlob) && !TEMPLATE.test(base);
}

// Commands that print, copy out or send what they read.
const READERS = new Set(
  ("cat bat less more head tail tac nl rev grep egrep fgrep rg ag ack awk gawk sed cut sort uniq strings xxd od hexdump base64 " +
    "diff cmp sdiff jq yq column fold fmt paste join comm look expand unexpand split csplit tar zip gzip bzip2 xz zstd dd curl wget " +
    "openssl gpg vi vim nvim view ex emacs nano").split(" "),
);
// Run their arguments or stdin as code: `node -e` with a path in it, a heredoc fed to python.
const INTERPRETERS = new Set("python python3 node ruby perl php deno bun tsx ts-node osascript".split(" "));
const SHELLS = new Set("sh bash zsh dash ksh fish eval".split(" "));
// Copy, move or link: reading the copy next would get past the name check, so the source counts as read.
const COPIERS = new Set("cp mv ln rsync scp install ditto".split(" "));
// Their first argument is a pattern or script, not a file: `grep .env .gitignore` reads .gitignore.
const PATTERN_FIRST = new Set("grep egrep fgrep rg ag ack sed awk gawk".split(" "));
const GIT_READS = new Set(["show", "diff", "blame", "cat-file", "grep"]);
// Words in front of the command that don't change what it reads.
const PREFIXES = new Set(["sudo", "command", "exec", "time", "nohup", "nice", "builtin", "{", "}", "!"]);
// Code that prints the whole environment: `console.log(process.env)`, `print(os.environ)`, Perl's %ENV.
const ENV_CODE = /process\.env\b(?!\s*(\.\w|\[))|os\.environ\b(?!\s*(\[|\.get\b))|%ENV\b|\bENV\.(to_h|to_a|to_s|each|inspect|keys|values|map|select|sort)\b/;
// `echo $STRIPE_SECRET_KEY` and the like.
const SECRET_VAR = /\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)\w*/i;
const XARGS_VALUED = new Set(["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a", "-J", "-R"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

const nameOf = (words: string[]) => path.basename(words[0] ?? "");

// `FOO=1 sudo env -u X cmd` runs cmd.
function stripPrefixes(words: string[]): string[] {
  let i = 0;
  const skip = (w = "") => ASSIGNMENT.test(w) || PREFIXES.has(w);
  while (i < words.length && skip(words[i])) i++;
  return words.slice(i);
}

function unwrapEnv(words: string[]): string[] {
  if (nameOf(words) !== "env") return words;
  let i = 1;
  const option = (w = "") => w.startsWith("-") || ASSIGNMENT.test(w);
  while (i < words.length && option(words[i])) i += words[i] === "-u" ? 2 : 1;
  return words.slice(i);
}

const lists = (args: string[]) => args.every((a) => /^-[a-zA-Z]*[px]/.test(a));
const printsSecretVar = (args: string[]) => args.some((a) => SECRET_VAR.test(a));
const DUMPS: Record<string, (args: string[]) => boolean> = {
  printenv: () => true,
  set: (args) => args.length === 0,
  env: (args) => args.every((a) => a.startsWith("-")),
  export: lists,
  declare: lists,
  typeset: lists,
  // ps shows every process's environment with BSD-style `e` or -E.
  ps: ([first = "", ...rest]) => (!first.startsWith("-") && first.includes("e")) || [first, ...rest].some((a) => /^-[a-zA-Z]*E/.test(a)),
  echo: printsSecretVar,
  printf: printsSecretVar,
};

function dumpsEnvironment(words: string[]): boolean {
  return DUMPS[nameOf(words)]?.(words.slice(1)) ?? false;
}

function pullsToStdout([cmd, sub, verb, ...rest]: string[]): boolean {
  return cmd === "vercel" && sub === "env" && verb === "pull" && rest.some((a) => a === "-" || a.startsWith("/dev/"));
}

// The pieces of a word that could be a path: `HEAD:.env`, `if=.env`, `@.env`, `readFileSync('.env')`.
function pathTokens(word: string): string[] {
  return expandBraces(word)
    .flatMap((w) => w.split(/[\s=:@,()'"`;<>|&]+/))
    .filter(Boolean);
}

function secretIn(words: string[], dataDir: string): string | undefined {
  return words.flatMap(pathTokens).find((t) => isSecretFile(t, dataDir));
}

// The command xargs or find -exec runs on the names it's given.
function innerCommand(cmd: string, args: string[]): string[] {
  if (cmd === "xargs") {
    let i = 0;
    while (args[i]?.startsWith("-")) i += XARGS_VALUED.has(args[i] ?? "") ? 2 : 1;
    return args.slice(i);
  }
  const at = args.findIndex((a) => /^-(exec|execdir|ok|okdir)$/.test(a));
  if (at < 0) return [];
  const end = args.findIndex((a, j) => j > at && (a === ";" || a === "+"));
  return args.slice(at + 1, end < 0 ? undefined : end);
}

// node, bun and deno load --env-file without printing it, unless there's inline code to print it with.
function envFileArgs(args: string[]): { files: string[]; rest: string[]; inline: boolean } {
  const files: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const m = /^--env-file(-if-exists)?(=(.*))?$/.exec(args[i] ?? "");
    if (!m) rest.push(args[i] ?? "");
    else files.push(m[2] ? (m[3] ?? "") : (args[++i] ?? ""));
  }
  return { files, rest, inline: rest.some((a) => /^(-e|-p|-pe|--eval|--print)$/.test(a)) };
}

// What one command is about to do, for the checks below.
interface Call {
  cmd: string;
  args: string[];
  stdin: string[];
  dataDir: string;
  depth: number;
  // Whether a secret is named anywhere on the line, for xargs and find, whose names arrive from elsewhere.
  namesSecret: () => boolean;
}

const hitReason = (hit: string | undefined) => (hit ? reason(hit) : null);

function readerVerdict({ cmd, args, dataDir }: Call): string | null {
  const patternGiven = args.some((a) => /^(-e|-f|--regexp|--file)(=|$)/.test(a));
  // The first plain argument, past sed -i's empty '' suffix on macOS.
  const pattern = PATTERN_FIRST.has(cmd) && !patternGiven ? args.findIndex((a) => a !== "" && !a.startsWith("-")) : -1;
  return hitReason(
    secretIn(
      args.filter((_, j) => j !== pattern),
      dataDir,
    ),
  );
}

function shellVerdict({ cmd, args, stdin, dataDir, depth }: Call): string | null {
  const c = args.indexOf("-c");
  const inline = args[c + 1];
  const scripts = cmd === "eval" ? [args.join(" ")] : [...stdin, ...(c >= 0 && inline ? [inline] : [])];
  return scripts.map((s) => bashVerdict(s, dataDir, depth + 1)).find(Boolean) ?? null;
}

function runsOnNamesVerdict(call: Call): string | null {
  const inner = innerCommand(call.cmd, call.args);
  const runs = nameOf(inner);
  if ((READERS.has(runs) || INTERPRETERS.has(runs) || SHELLS.has(runs)) && call.namesSecret()) return reason("a `.env` file", true);
  return inner.length ? commandVerdict({ ...blankCommand(), words: inner }, call.dataDir, call.depth, call.namesSecret) : null;
}

function interpreterVerdict({ args, stdin, dataDir }: Call): string | null {
  if ([...args, ...stdin].some((a) => ENV_CODE.test(a))) return ENV_DUMP;
  const { files, rest, inline } = envFileArgs(args);
  return hitReason(secretIn(stdin, dataDir) ?? secretIn(rest, dataDir) ?? (inline ? secretIn(files, dataDir) : undefined));
}

function copierVerdict({ args, dataDir }: Call): string | null {
  return hitReason(secretIn(args.filter((a) => !a.startsWith("-")).slice(0, -1), dataDir));
}

// git only with a subcommand that shows file contents; log only with a patch.
function gitVerdict(call: Call): string | null {
  const sub = call.args.find((a) => !a.startsWith("-")) ?? "";
  const shows = GIT_READS.has(sub) || (sub === "log" && call.args.some((a) => /^(-p|-u|--patch)$/.test(a)));
  return shows ? readerVerdict(call) : null;
}

function verdictFor(cmd: string): ((call: Call) => string | null) | null {
  if (SHELLS.has(cmd)) return shellVerdict;
  if (cmd === "xargs" || cmd === "find") return runsOnNamesVerdict;
  if (INTERPRETERS.has(cmd)) return interpreterVerdict;
  if (COPIERS.has(cmd)) return copierVerdict;
  if (cmd === "git") return gitVerdict;
  return READERS.has(cmd) ? readerVerdict : null;
}

// Why one simple command is turned away.
function commandVerdict({ words: raw, inputs, stdin }: SimpleCommand, dataDir: string, depth: number, namesSecret: () => boolean): string | null {
  const redirected = inputs.find((f) => isSecretFile(f, dataDir));
  if (redirected) return reason(redirected);
  const words = stripPrefixes(raw);
  if (dumpsEnvironment(words)) return ENV_DUMP;
  if (pullsToStdout(words)) return reason("`vercel env pull` to stdout", true);
  const [first = "", ...args] = unwrapEnv(words);
  const cmd = path.basename(first);
  return verdictFor(cmd)?.({ cmd, args, stdin, dataDir, depth, namesSecret }) ?? null;
}

// Why a shell command is turned away, or null to let it run.
export function bashVerdict(command: string, dataDir = DATA_DIR, depth = 0): string | null {
  if (depth > 5) return null;
  const { commands, nested } = parseShell(command);
  // A heredoc piped along (`cat <<EOF | bash`) reaches whatever runs it.
  let carried: string[] = [];
  const piped = commands.map((c) => {
    const fed = { ...c, stdin: [...carried, ...c.stdin] };
    carried = c.pipes ? fed.stdin : [];
    return fed;
  });
  const namesSecret = () => commands.some((c) => secretIn([...c.words, ...c.inputs], dataDir) !== undefined);
  return (
    piped.map((c) => commandVerdict(c, dataDir, depth, namesSecret)).find(Boolean) ??
    nested.map((n) => bashVerdict(n, dataDir, depth + 1)).find(Boolean) ??
    null
  );
}

// A file:// URL's path, or "" for any other URL.
function filePath(url: string): string {
  if (!/^file:/i.test(url)) return "";
  const bare = url.replace(/^file:(\/\/)?/i, "").replace(/[?#].*$/, "");
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
}

const FILE_TOOLS = new Set(["Read", "Edit", "MultiEdit", "NotebookRead", "NotebookEdit"]);

// Why a tool call is turned away, or null to let it run.
export function toolVerdict(toolName: string, input: unknown, dataDir = DATA_DIR): string | null {
  const fields = (input ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof fields[key] === "string" ? fields[key] : "");
  if (FILE_TOOLS.has(toolName)) {
    const file = str("file_path") || str("notebook_path");
    return isSecretFile(file, dataDir) ? reason(file) : null;
  }
  switch (toolName) {
    case "Grep":
      // ripgrep's globs match dotfiles, so `*.local` reaches .env.local.
      return hitReason([str("path"), ...expandBraces(str("glob"))].find((p) => p && isSecretFile(p, dataDir, true)));
    case "mcp__browser__open_url": {
      const file = filePath(str("url"));
      return file && isSecretFile(file, dataDir) ? reason(file) : null;
    }
    case "Bash":
      return bashVerdict(str("command"), dataDir);
    default:
      return null;
  }
}

// A file is named by its base name; literal text goes in as it is.
function reason(what: string, literal = false): string {
  const name = literal ? what : `\`${path.basename(what.replace(/^["']|["']$/g, ""))}\``;
  return (
    `Weft keeps secret values out of threads, so ${name} can't be read here. Work with names instead: ` +
    "read or edit `.env.example`, and ask the user to set the value themselves."
  );
}

const ENV_DUMP =
  "Weft keeps secret values out of threads, so dumping the environment or printing a secret variable is blocked. " +
  'To check one variable is set without printing it: `test -n "$NAME" && echo set`.';

export const secretGuard: HookCallback = (input) => {
  if (input.hook_event_name !== "PreToolUse") return Promise.resolve({});
  const why = toolVerdict(input.tool_name, input.tool_input);
  return Promise.resolve(
    why ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {},
  );
};

export const SECRET_GUARD_HOOKS: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
  PreToolUse: [{ matcher: "Read|Edit|MultiEdit|NotebookRead|NotebookEdit|Grep|Bash|mcp__browser__open_url", hooks: [secretGuard] }],
};
