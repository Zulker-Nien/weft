// The HTML a built app's pane shows: a success page (title, optional stylesheet, deferred app.js) and an error
// page (a friendly banner with the build's message), both marked <!-- weft:generated --> so the build leaves a
// hand-written index.html alone. Extracted from lib/app-build.ts to keep that file under 300 lines.
import fs from "node:fs";
import path from "node:path";
import { GENERATED_MARKER } from "./app-build";

// The folder's title, from weft-app.json's name when it's set, else the folder name (the slug).
export function appTitle(folder: string, slug: string): string {
  const manifest = path.join(folder, "weft-app.json");
  if (fs.existsSync(manifest)) {
    try {
      const data = JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: unknown };
      if (typeof data.name === "string" && data.name.trim()) return data.name.trim();
    } catch {}
  }
  return slug;
}

function htmlEscape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

// The page a successful build serves. The deferred <script src="./app.js"> is intentional: the page is loaded as
// file:// in Electron's pane, and a module script would refuse to load there.
export function writeIndexHtml(folder: string, title: string, hasCss: boolean) {
  const css = hasCss ? '  <link rel="stylesheet" href="./app.css">\n' : "";
  const html = `${GENERATED_MARKER}
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(title)}</title>
${css}  <script src="./app.js" defer></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>
`;
  fs.writeFileSync(path.join(folder, "index.html"), html);
}

// The page a failed build serves in the pane, so a typo or a syntax error still shows something. The previous
// app.js stays on disk (lib/app-build.ts restores it), so a re-save with a fix rebuilds and the page comes back.
export function writeErrorIndexHtml(folder: string, title: string, message: string) {
  const html = `${GENERATED_MARKER}
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(title)} (build failed)</title>
  <style>
    body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; background: #fff5f5; color: #2a1010; }
    h1 { margin: 0 0 12px; font-size: 16px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #ffffff; border: 1px solid #f3c2c2; border-radius: 8px; padding: 12px; margin: 0; font: 12px/1.5 ui-monospace, SFMono-Regular, monospace; }
  </style>
</head>
<body>
  <h1>${htmlEscape(title)} failed to build</h1>
  <pre>${htmlEscape(message)}</pre>
</body>
</html>
`;
  fs.writeFileSync(path.join(folder, "index.html"), html);
}