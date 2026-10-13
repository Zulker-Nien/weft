import { describe, expect, it } from "vitest";
import type { Delivery, Webhook } from "./webhooks";
import {
  badSecretName,
  blankCount,
  deliveryLabel,
  deliveryOk,
  deliveryTitle,
  emptyForm,
  eventsText,
  failingCount,
  filterWebhooks,
  folderOptions,
  formInput,
  formReady,
  groupByFolder,
  isFailing,
  parseEvents,
  parseWebhookAsk,
  relayState,
  shortTarget,
  upsertWebhook,
  webhooksTitle,
} from "./webhooks-view";

const hook = (over: Partial<Webhook> = {}): Webhook => ({ id: "w1", folder: "/dev/app", name: "stripe", target: "http://localhost:3000/api/stripe", createdAt: 0, updatedAt: 0, ...over });
const delivery = (over: Partial<Delivery> = {}): Delivery => ({ at: 1000, method: "POST", status: 200, ms: 12, ...over });

describe("parseWebhookAsk", () => {
  it("reads main's message", () => {
    expect(parseWebhookAsk('{"folder":"/dev/app","id":"w1","extra":1}')).toEqual({ folder: "/dev/app", id: "w1" });
  });
  it("ignores anything else", () => {
    expect(parseWebhookAsk(undefined)).toBeUndefined();
    expect(parseWebhookAsk("{nope")).toBeUndefined();
    expect(parseWebhookAsk("null")).toBeUndefined();
    expect(parseWebhookAsk('{"folder":"/a"}')).toBeUndefined();
    expect(parseWebhookAsk('{"folder":"/a","id":""}')).toBeUndefined();
  });
});

describe("counts and the rail title", () => {
  it("counts blanks and failing", () => {
    const hooks = [hook({ registered: true }), hook({ id: "b" }), hook({ id: "c", deliveries: [delivery({ status: 500 }), delivery()] }), hook({ id: "d", deliveries: [delivery()] })];
    expect(blankCount(hooks)).toBe(3);
    expect(failingCount(hooks)).toBe(1);
    expect(isFailing(hook())).toBe(false);
    expect(deliveryOk(delivery({ status: 204 }))).toBe(true);
    expect(deliveryOk(delivery({ status: 302 }))).toBe(false);
  });
  it("says what needs attention", () => {
    expect(webhooksTitle({ blanks: 0, failing: 0 })).toBe("Webhooks: what providers post to this project");
    expect(webhooksTitle({ blanks: 1, failing: 0 })).toContain("1 blank to register");
    expect(webhooksTitle({ blanks: 2, failing: 3 })).toContain("2 blanks to register · 3 failing");
  });
});

describe("filtering and grouping", () => {
  const hooks = [hook({ id: "1", name: "resend" }), hook({ id: "2", folder: "/dev/api", name: "b" }), hook({ id: "3", name: "a" })];
  it("filters by folder, or keeps all", () => {
    expect(filterWebhooks(hooks, "/dev/api").map((h) => h.id)).toEqual(["2"]);
    expect(filterWebhooks(hooks, null)).toHaveLength(3);
    expect(filterWebhooks(hooks, null)).not.toBe(hooks);
  });
  it("groups by folder, with empty folders and unlisted ones", () => {
    const sections = groupByFolder(hooks, ["/dev/app", "/dev/empty", "/dev/app"]);
    expect(sections.map((s) => s.label)).toEqual(["api", "app", "empty"]);
    expect(sections.find((s) => s.folder === "/dev/app")?.hooks.map((h) => h.name)).toEqual(["a", "resend"]);
    expect(sections.find((s) => s.folder === "/dev/empty")?.hooks).toEqual([]);
  });
  it("breaks a tie in names by path", () => {
    expect(groupByFolder([], ["/b/app", "/a/app"]).map((s) => s.folder)).toEqual(["/a/app", "/b/app"]);
  });
  it("lists the filter's choices", () => {
    expect(folderOptions(["/dev/web", "/dev/api"])).toEqual([
      { folder: "", label: "All projects" },
      { folder: "/dev/api", label: "api" },
      { folder: "/dev/web", label: "web" },
    ]);
  });
});

describe("row text", () => {
  it("shortens a target", () => {
    expect(shortTarget("http://localhost:3000/api/x?y=1")).toBe("/api/x?y=1");
    expect(shortTarget("http://localhost:3000/")).toBe("/");
    expect(shortTarget("http://localhost:3000")).toBe("/");
    expect(shortTarget("http://localhost:4000/api/x")).toBe("localhost:4000/api/x");
    expect(shortTarget("http://127.0.0.1:3000/")).toBe("127.0.0.1:3000");
    expect(shortTarget("not a url")).toBe("not a url");
  });
  it("counts events", () => {
    expect(eventsText(undefined)).toBeNull();
    expect(eventsText([])).toBeNull();
    expect(eventsText(["a"])).toBe("1 event");
    expect(eventsText(["a", "b"])).toBe("2 events");
  });
  it("labels deliveries", () => {
    expect(deliveryLabel(delivery({ at: 0 }), 120_000)).toBe("200 · 2m ago");
    expect(deliveryLabel(delivery({ status: 0, at: 0 }), 10_000)).toBe("unreachable · just now");
    expect(deliveryLabel(delivery({ at: Date.now() }))).toContain("just now");
    expect(deliveryTitle(delivery())).toBe("POST answered 200 in 12ms");
    expect(deliveryTitle(delivery({ status: 0, error: "ECONNREFUSED" }))).toBe("POST to an unreachable route in 12ms\nECONNREFUSED");
  });
  it("picks the public URL's state", () => {
    expect(relayState({ url: "https://weft.zip/h/1" }, false)).toBe("url");
    expect(relayState({}, true)).toBe("get");
    expect(relayState({}, false)).toBe("sign-in");
  });
});

describe("upsertWebhook", () => {
  it("adds or replaces", () => {
    const a = hook();
    expect(upsertWebhook([], a)).toEqual([a]);
    const changed = hook({ registered: true });
    expect(upsertWebhook([a, hook({ id: "w2" })], changed)).toEqual([changed, hook({ id: "w2" })]);
  });
});

describe("the Add form", () => {
  it("parses events", () => {
    expect(parseEvents(" a, b ,a,,")).toEqual(["a", "b"]);
    expect(parseEvents("")).toEqual([]);
  });
  it("needs a name and a route, and a valid secret name", () => {
    const form = emptyForm();
    expect(formReady(form)).toBe(false);
    expect(formReady({ ...form, name: "stripe", target: "/api/s" })).toBe(true);
    expect(formReady({ ...form, name: "stripe", target: "/api/s", secret: "9x" })).toBe(false);
    expect(badSecretName({ secret: "STRIPE_WEBHOOK_SECRET" })).toBe(false);
    expect(badSecretName({ secret: " " })).toBe(false);
  });
  it("sends only what was typed", () => {
    expect(formInput("/dev/app", { name: " stripe ", target: " /api/s ", events: "", hint: " ", secret: "" })).toEqual({ folder: "/dev/app", name: "stripe", target: "/api/s" });
    expect(formInput("/dev/app", { name: "s", target: "/x", events: "a, b", hint: "Dashboard", secret: "S_KEY" })).toEqual({
      folder: "/dev/app",
      name: "s",
      target: "/x",
      events: ["a", "b"],
      hint: "Dashboard",
      secret: "S_KEY",
    });
  });
});
