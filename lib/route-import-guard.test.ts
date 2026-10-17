import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addedImportProblems, contentAfter, importSpecs, isRouteFile, prerenderCheck, ROUTE_IMPORT_GUARD_MATCHER, routeImportCheck, routeImportGuard, routeImportReason } from "./route-import-guard";

let root: string;

function write(files: Record<string, string>) {
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
}

const at = (rel: string) => path.join(root, rel);

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "route-guard-")));
  write({ "package.json": "{}", "node_modules/next/package.json": "{}", "node_modules/@scope/pkg/package.json": "{}" });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("isRouteFile", () => {
  it.each(["app/page.tsx", "app/(home)/page.tsx", "app/x/layout.tsx", "app/template.tsx", "app/error.tsx", "app/global-error.tsx", "app/not-found.tsx", "app/a/loading.tsx", "app/@slot/default.tsx", "app/api/cards/route.ts", "src/app/page.jsx", "middleware.ts", "proxy.ts", "src/instrumentation.js"])("%s takes the app down", (rel) => {
    expect(isRouteFile(root, at(rel))).toBe(true);
  });

  it.each(["components/Board.tsx", "app/home/Hero.tsx", "app/api/x/route.tsx", "lib/page.tsx", "app/page.css", "lib/middleware.ts"])("%s doesn't", (rel) => {
    expect(isRouteFile(root, at(rel))).toBe(false);
  });
});

describe("importSpecs", () => {
  it("finds imports, re-exports, side-effect and dynamic imports, across lines", () => {
    const src = ['import a from "a";', "import {\n  b,\n} from './b';", 'export * from "@/c";', 'import "./d.css";', 'const e = await import("e");', "// no imports here"].join("\n");
    expect([...importSpecs(src)]).toEqual(["a", "./b", "@/c", "./d.css", "e"]);
  });
});

describe("contentAfter", () => {
  it("is a Write's content", () => {
    expect(contentAfter("Write", { content: "x" }, null)).toBe("x");
    expect(contentAfter("Write", {}, "old")).toBeNull();
  });

  it("applies an Edit to the first match, or every match with replace_all", () => {
    expect(contentAfter("Edit", { old_string: "a", new_string: "$&b" }, "a a")).toBe("$&b a");
    expect(contentAfter("Edit", { old_string: "a", new_string: "b", replace_all: true }, "a a")).toBe("b b");
  });

  it("applies a MultiEdit's edits in order", () => {
    const edits = [
      { old_string: "a", new_string: "b" },
      { old_string: "b", new_string: "c" },
    ];
    expect(contentAfter("MultiEdit", { edits }, "a")).toBe("c");
  });

  it("is null when the edit can't apply", () => {
    expect(contentAfter("Edit", { old_string: "a", new_string: "b" }, null)).toBeNull();
    expect(contentAfter("Edit", { old_string: "z", new_string: "b" }, "a")).toBeNull();
    expect(contentAfter("Edit", { old_string: 1, new_string: "b" }, "a")).toBeNull();
    expect(contentAfter("MultiEdit", { edits: "no" }, "a")).toBeNull();
  });
});

describe("addedImportProblems", () => {
  it("names the file to write first for a missing @/ or relative import", () => {
    const page = at("app/page.tsx");
    expect(addedImportProblems(page, "", 'import Home from "@/components/home/Home";\nimport s from "./s.css";')).toEqual([
      '"@/components/home/Home" doesn\'t exist yet: write components/home/Home.tsx first, then import it from app/page.tsx.',
      '"./s.css" doesn\'t exist yet: write app/s.css first, then import it from app/page.tsx.',
    ]);
    expect(addedImportProblems(at("app/api/x/route.ts"), null, 'import { y } from "../y";')).toEqual(['"../y" doesn\'t exist yet: write app/api/y.ts first, then import it from app/api/x/route.ts.']);
  });

  it("lets through imports that resolve, and ones the file already had", () => {
    write({ "components/home/Home.tsx": "export default 1;" });
    expect(addedImportProblems(at("app/page.tsx"), "", 'import Home from "@/components/home/Home";')).toEqual([]);
    expect(addedImportProblems(at("app/page.tsx"), 'import X from "@/gone";', 'import X from "@/gone";\nconst a = 1;')).toEqual([]);
  });

  it("checks packages against node_modules, skipping builtins, aliases and subpath imports", () => {
    const src = ['import "next/font/google";', 'import "@scope/pkg/x";', 'import fs from "node:fs";', 'import p from "path";', 'import "#internal";', 'import "~/x";', 'import "left-pad";'].join("\n");
    expect(addedImportProblems(at("app/layout.tsx"), null, src)).toEqual(['"left-pad" isn\'t installed: install left-pad first, then import it from app/layout.tsx.']);
  });

  it("skips packages when nothing is installed yet", () => {
    fs.rmSync(at("node_modules"), { recursive: true });
    expect(addedImportProblems(at("app/layout.tsx"), null, 'import "left-pad";')).toEqual([]);
  });

  it("ignores files that aren't route files, and files outside a project", () => {
    expect(addedImportProblems(at("components/X.tsx"), null, 'import "@/nope";')).toEqual([]);
    expect(addedImportProblems("/no-project-here/app/page.tsx", null, 'import "./nope";')).toEqual([]);
  });
});

describe("routeImportCheck and routeImportGuard", () => {
  const pre = (tool_name: string, tool_input: unknown) =>
    ({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "t", session_id: "s", transcript_path: "", cwd: root }) as unknown as HookInput;
  const run = (input: HookInput) => routeImportGuard(input, undefined, { signal: new AbortController().signal });

  it("explains the refusal and the order to work in", () => {
    const why = routeImportReason("app/page.tsx", ["x"]);
    expect(why).toContain("app/page.tsx is a route file");
    expect(why).toContain("- x");
  });

  it("denies the 2026-10-13 edit: app/page.tsx importing a Home not written yet", async () => {
    write({ "app/page.tsx": 'import Board from "@/components/Board";\n', "components/Board.tsx": "export default 1;" });
    const out = await run(pre("Edit", { file_path: "app/page.tsx", old_string: 'import Board from "@/components/Board";', new_string: 'import Board from "@/components/Board";\nimport Home from "@/components/home/Home";' }));
    expect(out).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
    expect(JSON.stringify(out)).toContain("write components/home/Home.tsx first, then import it from app/page.tsx");
  });

  it("lets through good edits, edits that can't apply and calls without a file", async () => {
    write({ "app/page.tsx": "export default 1;\n" });
    expect(await run(pre("Write", { file_path: at("app/page.tsx"), content: "export default 2;\n" }))).toEqual({});
    expect(await run(pre("Edit", { file_path: "app/page.tsx", old_string: "missing", new_string: 'import "@/x";' }))).toEqual({});
    expect(await run(pre("Write", { file_path: "app" }))).toEqual({});
    expect(routeImportCheck("Edit", null, root)).toBe("");
    expect(await run({ ...pre("Write", {}), hook_event_name: "PostToolUse" } as HookInput)).toEqual({});
  });

  it("runs on Edit, MultiEdit and Write", () => {
    expect(ROUTE_IMPORT_GUARD_MATCHER).toMatchObject({ matcher: "Edit|MultiEdit|Write", hooks: [routeImportGuard] });
  });
});

describe("prerenderCheck: what only `next build` refuses under cacheComponents", () => {
  const pre = (tool_name: string, tool_input: unknown) =>
    ({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "t", session_id: "s", transcript_path: "", cwd: root }) as unknown as HookInput;
  const run = (input: HookInput) => routeImportGuard(input, undefined, { signal: new AbortController().signal });
  const PAGE = "app/s/[id]/page.tsx";
  const AWAITS = "export default async function Page({ params }) { await params; return null; }\n";

  beforeEach(() => write({ "next.config.ts": "export default { cacheComponents: true };" }));

  it("denies the 88e1ff1 edit: a dynamic segment config", async () => {
    const out = await run(pre("Write", { file_path: PAGE, content: 'export const dynamic = "force-dynamic";\nexport default function Page() { return null; }\n' }));
    expect(out).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
    expect(JSON.stringify(out)).toContain("exports `dynamic`");
  });

  it("warns, without refusing, on the fcc13a8 edit: params awaited before the <Suspense>", async () => {
    const out = await run(pre("Write", { file_path: PAGE, content: AWAITS }));
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: expect.any(String) as string } });
    expect(JSON.stringify(out)).toContain("the default export awaits params outside <Suspense>");
  });

  it("says nothing about problems the file already had, or with cacheComponents off", async () => {
    write({ [PAGE]: AWAITS });
    expect(await run(pre("Edit", { file_path: PAGE, old_string: "null", new_string: "1" }))).toEqual({});
    write({ "next.config.ts": "export default {};" });
    expect(await prerenderCheck("Write", { file_path: "app/x/page.tsx", content: 'export const revalidate = 1;' }, root)).toEqual({ deny: "", warn: "" });
  });

  it("skips files that aren't routes, edits that can't apply and calls without a file", async () => {
    const none = { deny: "", warn: "" };
    expect(await prerenderCheck("Write", { file_path: "lib/x.ts", content: "export const dynamic = 1;" }, root)).toEqual(none);
    expect(await prerenderCheck("Edit", { file_path: PAGE, old_string: "a", new_string: "b" }, root)).toEqual(none);
    expect(await prerenderCheck("Write", null, root)).toEqual(none);
    expect(await prerenderCheck("Write", { file_path: "/no-project-here/app/page.tsx", content: "" }, root)).toEqual(none);
  });

  it("leaves it to the import check when the edit imports a missing module", async () => {
    const out = await run(pre("Write", { file_path: PAGE, content: 'import X from "./nope";\nexport const dynamic = 1;\n' }));
    expect(JSON.stringify(out)).toContain("doesn't exist yet");
    expect(JSON.stringify(out)).not.toContain("exports `dynamic`");
  });
});
