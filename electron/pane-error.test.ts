import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { describeFailure, errorPageUrl, failedUrl, watchLoadFailures, PAGE } from "./pane-error.cjs";

const params = (url: string) => new URL(url).searchParams;

describe("describeFailure", () => {
  it("says a local dev server isn't running, and waits for it", () => {
    const d = describeFailure({ url: "http://localhost:3457/", code: -102, description: "ERR_CONNECTION_REFUSED" });
    expect(d.title).toBe("Nothing is running at localhost:3457");
    expect(d.wait).toBe(true);
  });

  it("names the common failures without waiting on remote hosts", () => {
    expect(describeFailure({ url: "https://example.com/", code: -102, description: "x" })).toMatchObject({
      title: "example.com refused to connect",
      wait: false,
    });
    expect(describeFailure({ url: "file:///gone.html", code: -6, description: "" }).title).toBe("This page's file is gone");
    expect(describeFailure({ url: "https://nope.test/", code: -105, description: "" }).title).toBe("Can't find nope.test");
    expect(describeFailure({ url: "https://a.com/", code: -106, description: "" }).title).toBe("You're offline");
  });

  it("falls back to Chromium's description, waiting only for local pages", () => {
    expect(describeFailure({ url: "https://a.com/", code: -7, description: "ERR_TIMED_OUT" })).toEqual({
      title: "This page didn't load",
      hint: "ERR_TIMED_OUT",
      wait: false,
    });
    expect(describeFailure({ url: "http://127.0.0.1:5000/", code: -7, description: "" })).toMatchObject({ hint: "Error -7", wait: true });
    expect(describeFailure({ url: "not a url", code: -7, description: "" }).wait).toBe(false);
  });
});

describe("errorPageUrl and failedUrl", () => {
  it("round-trips the failed url and carries what the page shows", () => {
    const page = errorPageUrl({ url: "http://localhost:3457/a?b=1", code: -102, description: "ERR_CONNECTION_REFUSED", back: "file:///x.html" });
    expect(page.startsWith(`${PAGE}?`)).toBe(true);
    expect(failedUrl(page)).toBe("http://localhost:3457/a?b=1");
    const q = params(page);
    expect(q.get("wait")).toBe("1");
    expect(q.get("back")).toBe("file:///x.html");
    expect(q.get("reason")).toBe("ERR_CONNECTION_REFUSED");
  });

  it("leaves out a Back that is the failed page itself, and wait for remote pages", () => {
    const q = params(errorPageUrl({ url: "https://a.com/", code: -7, description: "", back: "https://a.com/" }));
    expect(q.has("back")).toBe(false);
    expect(q.has("wait")).toBe(false);
    expect(q.get("reason")).toBe("-7");
  });

  it("is undefined for any other page", () => {
    expect(failedUrl("http://localhost:3000/")).toBeUndefined();
    expect(failedUrl("")).toBeUndefined();
    expect(failedUrl(undefined)).toBeUndefined();
  });
});

describe("watchLoadFailures", () => {
  function contents() {
    const wc = Object.assign(new EventEmitter(), { loadURL: vi.fn<(url: string) => Promise<void>>(() => Promise.resolve()) });
    return wc;
  }

  it("loads the error page for a failed main-frame load, with the card's last page", () => {
    const wc = contents();
    const back = vi.fn(() => "file:///last.html");
    watchLoadFailures(wc, { back });
    wc.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "http://localhost:3457/", true);
    expect(back).toHaveBeenCalledWith("http://localhost:3457/");
    const page = wc.loadURL.mock.calls[0]![0];
    expect(failedUrl(page)).toBe("http://localhost:3457/");
    expect(params(page).get("back")).toBe("file:///last.html");
  });

  it("ignores subframes, aborted loads, empty urls and the error page itself", () => {
    const wc = contents();
    watchLoadFailures(wc);
    wc.emit("did-fail-load", {}, -102, "x", "http://localhost:1/", false);
    wc.emit("did-fail-load", {}, -3, "ERR_ABORTED", "http://localhost:1/", true);
    wc.emit("did-fail-load", {}, -102, "x", "", true);
    wc.emit("did-fail-load", {}, -6, "x", errorPageUrl({ url: "http://localhost:1/", code: -102, description: "", back: undefined }), true);
    wc.emit("did-fail-load", {}, -6, "x", PAGE, true);
    expect(wc.loadURL).not.toHaveBeenCalled();
  });

  it("swallows a failed error-page load", async () => {
    const wc = Object.assign(new EventEmitter(), { loadURL: vi.fn(() => Promise.reject(new Error("gone"))) });
    watchLoadFailures(wc);
    wc.emit("did-fail-load", {}, -102, "x", "http://localhost:1/", true);
    await Promise.resolve();
    expect(wc.loadURL).toHaveBeenCalledOnce();
  });
});
