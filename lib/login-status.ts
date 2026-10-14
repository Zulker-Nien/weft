import { execFile } from "node:child_process";
import { cliEnv } from "./env";
import type { Backend, CliStatus } from "./types";
import { binary, cleanOutput as clean, message } from "./login";

// Checks whether a CLI is logged in by running `<cli> auth status --json`. The CLI prints the
// JSON whether it succeeds or not, so a logged-out CLI can exit non-zero and still report its
// state. We time out and cap the buffer in case the CLI hangs.

const STATUS_TIMEOUT_MS = 10_000;

function parseStatus(stdout: string): CliStatus | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const data = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof data.loggedIn !== "boolean") return null;
    return typeof data.email === "string" && data.email
      ? { loggedIn: data.loggedIn, email: data.email }
      : { loggedIn: data.loggedIn };
  } catch {
    return null;
  }
}

function parseCodexStatus(stdout: string, stderr: string): CliStatus | null {
  const text = clean(`${stdout}\n${stderr}`).trim();
  if (/not logged in|not authenticated|no auth(?:entication)? (?:data|credentials)|logged out/i.test(text)) {
    return { loggedIn: false };
  }
  if (/logged in|authenticated/i.test(text)) return { loggedIn: true };
  return null;
}

export async function authStatus(backend: Backend): Promise<CliStatus> {
  let bin: string;
  try {
    bin = binary(backend);
  } catch (err) {
    return { loggedIn: false, error: message(err) };
  }
  return new Promise((resolve) => {
    // A logged-out CLI can exit non-zero and still print its status JSON.
    const args = backend === "codex" ? ["login", "status"] : ["auth", "status", "--json"];
    const env = cliEnv();
    if (backend === "codex") delete env.CLAUDE_CODE_ENTRYPOINT;
    execFile(
      bin,
      args,
      { env, timeout: STATUS_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout: string | undefined, stderr: string | undefined) => {
        const status = backend === "codex"
          ? parseCodexStatus(stdout ?? "", stderr ?? "")
          : parseStatus(stdout ?? "");
        if (status) {
          resolve(status);
          return;
        }
        const detail = clean(stderr ?? "").trim() || (err ? message(err) : "") || "No status in the CLI's output.";
        resolve({ loggedIn: false, error: detail.slice(0, 500) });
      },
    );
  });
}
