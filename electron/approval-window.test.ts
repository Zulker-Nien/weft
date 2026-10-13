import { describe, expect, it } from "vitest";
import { approvalHtml } from "./approval-window.cjs";

const base = { command: "node send.js", cwd: "/p", names: ["K"], environment: "development", label: "o/r" };

describe("approvalHtml", () => {
  it("names the asking card and quotes its reason, escaped", () => {
    const html = approvalHtml({ ...base, thread: "Mail <forwarding>", why: "Send a <b>test</b> email" });
    expect(html).toContain('<b class="thread">Mail &lt;forwarding&gt;</b> wants to run this');
    expect(html).toContain('<div class="why"><div class="label">Why</div><p>Send a &lt;b&gt;test&lt;/b&gt; email</p></div>');
  });

  it("falls back to 'A thread' and no Why block without them", () => {
    const html = approvalHtml(base);
    expect(html).toContain("A thread wants to run this");
    expect(html).not.toContain('class="why"');
  });

  it("names the card whose dev server it is", () => {
    expect(approvalHtml({ ...base, kind: "dev", thread: "Site" })).toContain(`<b class="thread">Site</b>'s dev server gets`);
    expect(approvalHtml({ ...base, kind: "dev" })).toContain("This card's dev server gets");
  });
});
