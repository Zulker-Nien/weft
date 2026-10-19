import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";

// A plan the agent wrote through ExitPlanMode (Claude Code) or the puku equivalent: long Markdown that
// doesn't fit the inline permission prompt. Weft writes one self-contained page per request and shows it
// in the card's browser pane, the same way AskUserQuestion option previews do (lib/question-preview.ts).
// The inline thread item becomes a one-line "Plan ready" with a link to this page, so the user reads the
// plan in the pane where it has room and the Allow/Deny buttons stay in the thread.

const DIR = path.join(DATA_DIR, "show");

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// Crude Markdown → HTML for a plan. Plans are short, mostly headings and lists; we don't need a real
// parser. Escapes the input first so user content can't break out, then re-applies its own structure.
type RenderState = { out: string[]; inList: boolean; inOrdered: boolean; inCode: boolean; codeBuf: string[] };

function closeLists(s: RenderState) {
  if (s.inList) {
    s.out.push("</ul>");
    s.inList = false;
  }
  if (s.inOrdered) {
    s.out.push("</ol>");
    s.inOrdered = false;
  }
}

function renderFence(s: RenderState) {
  closeLists(s);
  if (s.inCode) {
    s.out.push(`<pre><code>${s.codeBuf.join("\n")}</code></pre>`);
    s.codeBuf = [];
    s.inCode = false;
  } else {
    s.inCode = true;
  }
}

function renderHeading(s: RenderState, hashes: string, text: string) {
  closeLists(s);
  s.out.push(`<h${hashes.length}>${inline(text)}</h${hashes.length}>`);
}

function renderUl(s: RenderState, text: string) {
  if (s.inOrdered) {
    s.out.push("</ol>");
    s.inOrdered = false;
  }
  if (!s.inList) {
    s.out.push("<ul>");
    s.inList = true;
  }
  s.out.push(`<li>${inline(text)}</li>`);
}

function renderOl(s: RenderState, text: string) {
  if (s.inList) {
    s.out.push("</ul>");
    s.inList = false;
  }
  if (!s.inOrdered) {
    s.out.push("<ol>");
    s.inOrdered = true;
  }
  s.out.push(`<li>${inline(text)}</li>`);
}

function renderParagraph(s: RenderState, text: string) {
  closeLists(s);
  s.out.push(`<p>${inline(text)}</p>`);
}

function render(md: string): string {
  const lines = escape(md).split("\n");
  const state: RenderState = { out: [], inList: false, inOrdered: false, inCode: false, codeBuf: [] };
  for (const raw of lines) {
    if (raw.startsWith("```")) {
      renderFence(state);
      continue;
    }
    if (state.inCode) {
      state.codeBuf.push(raw);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading && heading[1] && heading[2]) {
      renderHeading(state, heading[1], heading[2]);
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (ul && ul[1]) {
      renderUl(state, ul[1]);
      continue;
    }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(raw);
    if (ol && ol[1]) {
      renderOl(state, ol[1]);
      continue;
    }
    if (raw.trim() === "") {
      closeLists(state);
      continue;
    }
    renderParagraph(state, raw);
  }
  closeLists(state);
  if (state.inCode) state.out.push(`<pre><code>${state.codeBuf.join("\n")}</code></pre>`);
  return state.out.join("\n");
}

// Bold, code, links inside a line. Escape runs first (in render), so the patterns are safe to inject.
function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`);
}

export const PLAN_TOOL = "ExitPlanMode";

// True when this tool's input carries a plan Weft should put in the pane.
export function isPlanTool(toolName: string): boolean {
  return toolName === PLAN_TOOL;
}

// A plan the agent sent: usually input.plan, else the whole input as a last resort.
function planOf(input: Record<string, unknown>): string {
  const plan = input.plan;
  if (typeof plan === "string" && plan.trim()) return plan;
  return JSON.stringify(input, null, 2);
}

export function planPage(plan: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Plan</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; background: #faf9f6; color: #1c1b18; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; padding: 28px 32px 48px; }
@media (prefers-color-scheme: dark) { body { background: #151513; color: #ecebe6; } }
main { max-width: 720px; margin: 0 auto; }
header { display: flex; align-items: center; gap: 10px; padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid rgb(20 20 15 / .12); }
@media (prefers-color-scheme: dark) { header { border-color: rgb(255 255 245 / .12); } }
header h1 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #6a6862; }
header h1::before { content: "✓"; color: #2c6bd6; margin-right: 8px; font-size: 15px; }
h1, h2, h3, h4, h5, h6 { letter-spacing: -.01em; line-height: 1.3; }
h1 { font-size: 22px; margin: 24px 0 8px; }
h2 { font-size: 18px; margin: 22px 0 6px; }
h3 { font-size: 15px; margin: 18px 0 4px; }
p { margin: 0 0 12px; }
ul, ol { margin: 0 0 12px; padding-left: 22px; }
li { margin: 0 0 4px; }
code { font: 12.5px/1.4 ui-monospace, "SF Mono", Menlo, monospace; background: rgb(28 27 24 / .08); padding: 1px 5px; border-radius: 4px; }
@media (prefers-color-scheme: dark) { code { background: rgb(236 235 230 / .12); } }
pre { background: rgb(28 27 24 / .06); padding: 14px 16px; border-radius: 8px; overflow: auto; margin: 0 0 14px; }
@media (prefers-color-scheme: dark) { pre { background: rgb(236 235 230 / .08); } }
pre code { background: transparent; padding: 0; }
a { color: #2c6bd6; text-decoration: underline; text-underline-offset: 2px; }
strong { font-weight: 600; }
</style></head>
<body><main>
<header><h1>Plan</h1></header>
${render(plan)}
</main></body></html>`;
}

// Writes the page for a plan approval and returns its file URL, or undefined when the tool isn't a plan
// or the input has no plan text to show. Failure is silent: the inline prompt keeps working.
export function writePlanPreview(cardId: string, toolName: string, input: Record<string, unknown>): string | undefined {
  if (!isPlanTool(toolName)) return undefined;
  const plan = planOf(input);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `${cardId}-plan.html`);
    fs.writeFileSync(file, planPage(plan));
    return `file://${file}`;
  } catch {
    return undefined;
  }
}
