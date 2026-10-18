import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_COMMANDS,
  detectDevCommands,
  guessUrl,
  namedPort,
  runScript,
  scriptFile,
} from "./dev-commands";

let folder: string;
let folders: string[] = [];

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-dev-cmds-"));
  folders.push(folder);
});

afterEach(() => {
  for (const f of folders) fs.rmSync(f, { recursive: true, force: true });
  folders = [];
});

const write = (name: string, body: string) => {
  const p = path.join(folder, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

describe("namedPort", () => {
  it("reads -p, --port, --port=, and PORT=", () => {
    expect(namedPort("next dev -p 4001")).toBe(4001);
    expect(namedPort("vite --port 5173")).toBe(5173);
    expect(namedPort("vite --port=5174")).toBe(5174);
    expect(namedPort("PORT=4002 next dev")).toBe(4002);
  });

  it("ignores a number that isn't a port flag", () => {
    expect(namedPort("next dev")).toBeUndefined();
    expect(namedPort("PORT=abc npm run dev")).toBeUndefined();
    expect(namedPort("repeats 4001 times")).toBeUndefined();
  });
});

describe("guessUrl", () => {
  it("uses the named port when one is set", () => {
    expect(guessUrl("next dev --port 4001")).toBe("http://localhost:4001");
  });

  it("falls back to a framework default", () => {
    expect(guessUrl("next dev")).toBe("http://localhost:3000");
    expect(guessUrl("vite")).toBe("http://localhost:5173");
    expect(guessUrl("astro dev")).toBe("http://localhost:4321");
    expect(guessUrl("wrangler dev")).toBe("http://localhost:8787");
    expect(guessUrl("npm run storybook")).toBe("http://localhost:6006");
    expect(guessUrl("ng serve")).toBe("http://localhost:4200");
    expect(guessUrl("gatsby develop")).toBe("http://localhost:8000");
    expect(guessUrl("expo start")).toBe("http://localhost:8081");
    expect(guessUrl("hugo server")).toBe("http://localhost:1313");
    expect(guessUrl("eleventy --serve")).toBe("http://localhost:8080");
    expect(guessUrl("nuxt dev")).toBe("http://localhost:3000");
    expect(guessUrl("bin/dev")).toBe("http://localhost:3000");
    expect(guessUrl("python3 manage.py runserver")).toBe("http://localhost:8000");
  });

  it("switches to 127.0.0.1 when the script says so", () => {
    expect(guessUrl("next dev -p 4001 -H 127.0.0.1")).toBe("http://127.0.0.1:4001");
    expect(guessUrl("vite --host 127.0.0.1 --port 5173")).toBe("http://127.0.0.1:5173");
  });

  it("returns undefined when the command has no port and no default", () => {
    expect(guessUrl("npm test")).toBeUndefined();
  });
});

describe("scriptFile", () => {
  it("reads the body of a file the script hands off to", () => {
    write("scripts/dev.sh", "PORT=4002 next dev\n");
    expect(scriptFile(folder, "sh scripts/dev.sh")).toBe("PORT=4002 next dev\n");
  });

  it("supports the common script-language prefixes", () => {
    write("scripts/dev.mjs", "vite --port 4003\n");
    expect(scriptFile(folder, "node scripts/dev.mjs")).toBe("vite --port 4003\n");
  });

  it("returns undefined when the file is missing", () => {
    expect(scriptFile(folder, "sh scripts/dev.sh")).toBeUndefined();
    expect(scriptFile(folder, "npm run dev")).toBeUndefined();
  });
});

describe("runScript", () => {
  const runWith = (lockfile: string | null, pkgManager?: unknown) => {
    const f = fs.mkdtempSync(path.join(os.tmpdir(), "weft-runscript-"));
    folders.push(f);
    if (lockfile) fs.writeFileSync(path.join(f, lockfile), "");
    return runScript(f, { packageManager: pkgManager }, "dev");
  };
  it("uses pnpm, yarn, or npm run per the lockfile or packageManager field", () => {
    expect(runWith(null)).toBe("npm run dev");
    expect(runWith("pnpm-lock.yaml")).toBe("pnpm dev");
    expect(runWith("yarn.lock")).toBe("yarn dev");
    expect(runWith("bun.lockb")).toBe("bun run dev");
    expect(runWith("bun.lock")).toBe("bun run dev");
    expect(runWith(null, "pnpm@9.0.0")).toBe("pnpm dev");
  });

  it("ignores a non-string packageManager", () => {
    expect(runScript(folder, { packageManager: 42 }, "dev")).toBe("npm run dev");
  });
});

describe("detectDevCommands", () => {
  it("reads package.json scripts and runs them through the right package manager", () => {
    write("package.json", JSON.stringify({ scripts: { dev: "next dev --port 4001", build: "next build", test: "vitest" } }));
    write("pnpm-lock.yaml", "");
    expect(detectDevCommands(folder)).toEqual([
      { command: "pnpm dev", label: "dev", url: "http://localhost:4001" },
    ]);
  });

  it("ranks known names first and falls back to the framework regex", () => {
    write("package.json", JSON.stringify({ scripts: { storybook: "storybook dev -p 6006", dev: "next dev", random: "vite --port 3001" } }));
    const cmds = detectDevCommands(folder);
    expect(cmds.map((c) => c.label)).toEqual(["dev", "storybook", "random"]);
  });

  it("treats 'vite build' as a non-server script but 'vite' and 'vite --port 3001' as commands", () => {
    write("package.json", JSON.stringify({ scripts: { build: "vite build", watch: "vite", custom: "vite --port 3001" } }));
    const labels = detectDevCommands(folder).map((c) => c.label);
    expect(labels).toEqual(["watch", "custom"]);
    expect(detectDevCommands(folder).find((c) => c.label === "custom")?.url).toBe("http://localhost:3001");
  });

  it("uses a packageManager field over the lockfile", () => {
    write("package.json", JSON.stringify({ packageManager: "yarn@4.0.0", scripts: { dev: "next dev" } }));
    write("pnpm-lock.yaml", "");
    expect(detectDevCommands(folder)[0]?.command).toBe("yarn dev");
  });

  it("picks up a port the script's file names when the script itself doesn't", () => {
    write("scripts/dev.sh", "PORT=4002 next dev\n");
    write("package.json", JSON.stringify({ scripts: { dev: "sh scripts/dev.sh" } }));
    expect(detectDevCommands(folder)).toEqual([
      { command: "npm run dev", label: "dev", url: "http://localhost:4002" },
    ]);
  });

  it("falls through when a hand-off file is missing", () => {
    write("package.json", JSON.stringify({ scripts: { dev: "sh scripts/missing.sh" } }));
    expect(detectDevCommands(folder)).toEqual([
      { command: "npm run dev", label: "dev" },
    ]);
  });

  it("returns [] on bad JSON and ignores non-string scripts", () => {
    write("package.json", "{ not json");
    expect(detectDevCommands(folder)).toEqual([]);

    write("package.json", JSON.stringify({ scripts: { dev: "next dev", other: 42 } }));
    expect(detectDevCommands(folder)).toEqual([
      { command: "npm run dev", label: "dev", url: "http://localhost:3000" },
    ]);
  });

  it("treats a missing scripts field as empty", () => {
    write("package.json", JSON.stringify({ name: "x" }));
    expect(detectDevCommands(folder)).toEqual([]);
  });

  it("uses a Procfile's web line", () => {
    write("Procfile", "web: next dev --port 4010\nworker: node worker.js\n");
    expect(detectDevCommands(folder)).toEqual([
      { command: "next dev --port 4010", label: "Procfile web", url: "http://localhost:4010" },
    ]);
  });

  it("returns [] when the Procfile has no web line", () => {
    write("Procfile", "worker: node worker.js\n");
    expect(detectDevCommands(folder)).toEqual([]);
  });

  it("prefers bin/dev, then bin/rails, then manage.py", () => {
    write("bin/dev", "");
    expect(detectDevCommands(folder)).toEqual([
      { command: "bin/dev", label: "bin/dev", url: "http://localhost:3000" },
    ]);
    fs.rmSync(path.join(folder, "bin/dev"));

    write("bin/rails", "");
    expect(detectDevCommands(folder)).toEqual([
      { command: "bin/rails server", label: "Rails", url: "http://localhost:3000" },
    ]);
    fs.rmSync(path.join(folder, "bin/rails"));

    write("manage.py", "");
    expect(detectDevCommands(folder)).toEqual([
      { command: "python3 manage.py runserver", label: "manage.py", url: "http://localhost:8000" },
    ]);
    write(".venv/bin/python", "");
    expect(detectDevCommands(folder)).toEqual([
      { command: ".venv/bin/python manage.py runserver", label: "manage.py", url: "http://localhost:8000" },
    ]);
  });

  it("reads deno.json and deno.jsonc for dev/start tasks", () => {
    write("deno.json", JSON.stringify({ tasks: { dev: "deno run --port 5050 main.ts", build: "deno bundle" } }));
    expect(detectDevCommands(folder)).toEqual([
      { command: "deno task dev", label: "deno dev", url: "http://localhost:5050" },
    ]);
    fs.rmSync(path.join(folder, "deno.json"));

    write("deno.jsonc", JSON.stringify({ tasks: { start: "deno run main.ts" } }));
    expect(detectDevCommands(folder)).toEqual([
      { command: "deno task start", label: "deno start" },
    ]);
  });

  it("returns [] when a Makefile has no recognised target", () => {
    write("Makefile", "all:\n\techo hi\n");
    expect(detectDevCommands(folder)).toEqual([]);
  });

  it("finds a Makefile's dev, run, serve or start target", () => {
    write("Makefile", "all:\n\techo hi\nserve:\n\tnpm start\n");
    expect(detectDevCommands(folder)).toEqual([
      { command: "make serve", label: "make serve" },
    ]);
  });

  it("uses wrangler only when package.json has no commands", () => {
    write("wrangler.toml", "name = \"x\"\n");
    expect(detectDevCommands(folder)).toEqual([
      { command: "npx wrangler dev", label: "wrangler", url: "http://localhost:8787" },
    ]);

    const other = fs.mkdtempSync(path.join(os.tmpdir(), "weft-dev-cmds-2-"));
    folders.push(other);
    fs.writeFileSync(path.join(other, "wrangler.toml"), "name = \"y\"\n");
    fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
    expect(detectDevCommands(other)).toEqual([
      { command: "npm run dev", label: "dev", url: "http://localhost:3000" },
    ]);
  });

  it("caps the result at MAX_COMMANDS and dedupes by command", () => {
    // Same command from two sources (package.json script and a Procfile) collapses into one.
    write("package.json", JSON.stringify({ scripts: { dev: "next dev", start: "vite", preview: "wrangler dev", custom: "astro dev" } }));
    write("Procfile", "web: next dev\n");
    const cmds = detectDevCommands(folder);
    // dev appears once even though both package.json and Procfile mention it; the first MAX_COMMANDS only.
    expect(cmds.length).toBe(3);
    expect(MAX_COMMANDS).toBe(3);
    expect(cmds.map((c) => c.command)).toEqual(["npm run dev", "npm run start", "npm run preview"]);
  });

  it("returns [] for a folder with none of the recognised files", () => {
    expect(detectDevCommands(folder)).toEqual([]);
  });
});
