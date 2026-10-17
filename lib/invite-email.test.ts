import { describe, expect, it } from "vitest";
import { inviteEmailBody } from "@aimhuge/teams";
import { inviteEmailHtml, inviteHtmlFor, parseInviteText } from "./invite-email";

const URL_ = "https://weft.zip/invite/abc_123";
const TEXT = inviteEmailBody({ orgName: "Alex Miller", appName: "Weft", role: "member", claimUrl: URL_, inviterEmail: "fotoflo@gmail.com" });

describe("parseInviteText", () => {
  it("reads the facts back out of the package's own invite text", () => {
    expect(parseInviteText(TEXT)).toEqual({ inviter: "fotoflo@gmail.com", org: "Alex Miller", app: "Weft", role: "member", url: URL_ });
  });

  it("takes 'an' before a role", () => {
    expect(parseInviteText(`a@b.c invited you to join "X" on Weft as an admin.\n\n${URL_}`)?.role).toBe("admin");
  });

  it("is null for text that isn't an invite or has no link", () => {
    expect(parseInviteText("Body")).toBeNull();
    expect(parseInviteText(`a@b.c invited you to join "X" on Weft as a member.\nno link here`)).toBeNull();
  });
});

describe("inviteEmailHtml", () => {
  it("links the button, shows the car from the link's origin and names who and where", () => {
    const html = inviteEmailHtml({ inviter: "fotoflo@gmail.com", org: "Alex Miller", app: "Weft", role: "member", url: URL_ });
    expect(html).toContain(`href="${URL_}"`);
    expect(html).toContain('src="https://weft.zip/brand/email/salt-flats.jpg"');
    expect(html).toContain("Join Alex Miller on Weft");
    expect(html).toContain("as a member");
    expect(html).toContain(">weft.zip</a>");
  });

  it("escapes a workspace name", () => {
    const html = inviteEmailHtml({ inviter: "a@b.c", org: `<b>"Evil" & co</b>`, app: "Weft", role: "member", url: URL_ });
    expect(html).toContain("&lt;b&gt;&quot;Evil&quot; &amp; co&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("inviteHtmlFor", () => {
  it("is HTML for an invite and undefined for anything else", () => {
    expect(inviteHtmlFor(TEXT)).toMatch(/^<!doctype html>/);
    expect(inviteHtmlFor("Body")).toBeUndefined();
  });
});
