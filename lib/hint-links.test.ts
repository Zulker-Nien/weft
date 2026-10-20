import { describe, expect, it } from "vitest";
import { hintParts, linkLabel } from "./hint-links";

describe("hintParts", () => {
  it("keeps plain text whole", () => {
    expect(hintParts("Stripe dashboard → API keys")).toEqual([{ text: "Stripe dashboard → API keys" }]);
  });

  it("splits out links between text", () => {
    expect(hintParts("Stripe → Webhooks: https://dashboard.stripe.com/webhooks then reveal")).toEqual([
      { text: "Stripe → Webhooks: " },
      { url: "https://dashboard.stripe.com/webhooks" },
      { text: " then reveal" },
    ]);
  });

  it("leaves sentence punctuation and a closing paren out of the link", () => {
    expect(hintParts("(see https://a.com/x).")).toEqual([{ text: "(see " }, { url: "https://a.com/x" }, { text: ")." }]);
  });

  it("keeps a paren the link opened", () => {
    expect(hintParts("http://w.org/A_(b)")).toEqual([{ url: "http://w.org/A_(b)" }]);
  });

  it("handles several links", () => {
    expect(hintParts("https://a.com, https://b.com")).toEqual([{ url: "https://a.com" }, { text: ", " }, { url: "https://b.com" }]);
  });
});

describe("linkLabel", () => {
  it("drops the scheme and a trailing slash", () => {
    expect(linkLabel("https://dashboard.stripe.com/")).toBe("dashboard.stripe.com");
    expect(linkLabel("http://a.com/x")).toBe("a.com/x");
  });
});
