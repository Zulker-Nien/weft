import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";
import type { Question } from "./types";

// An AskUserQuestion option can carry a preview (a mockup, a snippet). Claude Code draws it in a box
// beside the options; Weft shows it in the card's browser pane: one page per question set, which the
// board opens at #<question>-<option> as you move through the options.

const DIR = path.join(DATA_DIR, "show");

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export const hasPreviews = (questions: Question[]) => questions.some((q) => q.options.some((o) => o.preview));

export function previewPage(questions: Question[]) {
  const sections = questions.flatMap((q, qi) =>
    q.options.map((o, oi) => {
      const dots = q.options.map((_, i) => `<i class="${i === oi ? "on" : ""}"></i>`).join("");
      return `<section id="${qi}-${oi}">
<p class="q">${q.header ? `<span>${escape(q.header)}</span>` : ""}${escape(q.question)}</p>
<h1><b>${oi + 1}.</b> ${escape(o.label)}</h1>
${o.description ? `<p class="d">${escape(o.description)}</p>` : ""}
${o.preview ? `<pre>${escape(o.preview)}</pre>` : `<p class="none">No preview for this option.</p>`}
<div class="dots">${dots}</div>
</section>`;
    }),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>Question preview</title><style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;background:#0f141b;color:#dfe6ee;font:14px/1.5 -apple-system,system-ui,sans-serif;display:flex;align-items:flex-start;justify-content:center}
section{display:none;width:min(760px,100%);padding:32px 28px;box-sizing:border-box}
section.on{display:block}
.q{color:#8a97a6;margin:0 0 14px}.q span{background:#1d2632;color:#b8c4d0;border-radius:4px;padding:1px 7px;margin-right:8px;font-size:12px}
h1{font-size:22px;margin:0 0 6px}h1 b{color:#6fe0c8;font-weight:600}
.d{color:#b8c4d0;margin:0 0 18px}
pre{margin:0;padding:18px 20px;border:1px solid #2f3a48;border-radius:10px;background:#141b24;font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre;overflow:auto}
.none{color:#5c6876;font-style:italic}
.dots{display:flex;gap:6px;margin-top:18px}.dots i{width:7px;height:7px;border-radius:50%;background:#2f3a48}.dots i.on{background:#6fe0c8}
</style></head><body>
${sections.join("\n")}
<script>
const show = () => {
  const id = location.hash.slice(1) || "0-0";
  for (const s of document.querySelectorAll("section")) s.classList.toggle("on", s.id === id);
};
addEventListener("hashchange", show);
show();
</script>
</body></html>`;
}

// Writes the page for a pending question and returns its file URL, or undefined when no option has a preview.
export function writeQuestionPreview(cardId: string, questions: Question[]) {
  if (!hasPreviews(questions)) return undefined;
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${cardId}-question.html`);
  fs.writeFileSync(file, previewPage(questions));
  return `file://${file}`;
}
