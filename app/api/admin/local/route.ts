// The Settings admin page's data source. Reads the local Weft install
// (~/.weft/, the board file, the threads dir, the activity log, the Weft
// version) for the SuperAdmin to eyeball. Never proxied — local-only, the
// admin gate kept for symmetry with the Users page (no point letting any
// other visitor at the install's files).
import fs from "node:fs";
import path from "node:path";
import { requireSuperAdminWeft } from "@/lib/admin";
import { ACTIVITY_FILE } from "@/lib/activity";
import { DATA_DIR } from "@/lib/store";
import { fail, guard } from "@/lib/guard";

export interface AdminLocalOverview {
  dataDir: string;
  version: string;
  uptime: number;
  board: { cards: number; archived: number; threads: number };
  activity: { entries: number; lastAt: number | null };
  pages: { count: number; bytes: number };
  settings: { maxKeepAliveMinutes: number | null };
}

function statSafe(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function readJsonSafe(p: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readTail(lineCount: number): string[] {
  try {
    const content = fs.readFileSync(ACTIVITY_FILE, "utf8");
    const lines = content.split(/\n/);
    return lines.slice(-lineCount).filter(Boolean);
  } catch {
    return [];
  }
}

function readVersion(): string {
  // The app exposes its package version via env in production; in dev a
  // plausible fallback makes the page render rather than 500.
  return process.env.npm_package_version ?? process.env.WEFT_VERSION ?? "dev";
}

function settingsFile(): string {
  return path.join(DATA_DIR, "settings.json");
}

// The work, extracted so the page can call it directly (no self-fetch through
// the localhost guard). The HTTP handler wraps this with the guard + the
// fail() envelope, and so does the admin page (after its own gate).
export function loadAdminLocalOverview(): AdminLocalOverview {
  const boardPath = path.join(DATA_DIR, "board.json");
  const board = readJsonSafe(boardPath) as { cards?: unknown[] } | null;
  const cards = Array.isArray(board?.cards) ? board.cards : [];

  const threadsDir = path.join(DATA_DIR, "threads");
  const threadFiles = fs.existsSync(threadsDir) ? fs.readdirSync(threadsDir) : [];

  const pagesDir = path.join(DATA_DIR, "pages");
  let pagesCount = 0;
  let pagesBytes = 0;
  if (fs.existsSync(pagesDir)) {
    for (const name of fs.readdirSync(pagesDir)) {
      const full = path.join(pagesDir, name);
      const st = statSafe(full);
      if (st?.isFile()) {
        pagesCount += 1;
        pagesBytes += st.size;
      }
    }
  }

  const lastActivity = readTail(1);
  let lastAt: number | null = null;
  if (lastActivity.length) {
    const last = lastActivity[lastActivity.length - 1];
    if (last) {
      try {
        const obj = JSON.parse(last) as { ts?: number };
        if (typeof obj.ts === "number") lastAt = obj.ts;
      } catch {
        // ignore — keep lastAt null
      }
    }
  }
  const totalActivity = (() => {
    try {
      return fs.readFileSync(ACTIVITY_FILE, "utf8").split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  })();

  const settings = readJsonSafe(settingsFile()) as { keepAliveMinutes?: number } | null;

  return {
    dataDir: DATA_DIR,
    version: readVersion(),
    uptime: Math.round(process.uptime()),
    board: {
      cards: cards.filter((c): c is { archived?: boolean } => typeof c === "object" && c !== null).length,
      archived: cards.filter((c): c is { archived?: boolean } => typeof c === "object" && c !== null && Boolean((c as { archived?: boolean }).archived)).length,
      threads: threadFiles.length,
    },
    activity: { entries: totalActivity, lastAt },
    pages: { count: pagesCount, bytes: pagesBytes },
    settings: {
      maxKeepAliveMinutes:
        typeof settings?.keepAliveMinutes === "number" ? settings.keepAliveMinutes : null,
    },
  };
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  try {
    await requireSuperAdminWeft();
    return Response.json(loadAdminLocalOverview());
  } catch (err) {
    return fail(err);
  }
}

