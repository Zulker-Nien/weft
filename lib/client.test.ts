// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, mergeThread, type NewCardInput } from "./client";
import type { ThreadItem } from "./types";

type FetchCall = [string, RequestInit];

function respond(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: init.status ?? 200, statusText: init.statusText })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const lastCall = (fetch: ReturnType<typeof respond>) => fetch.mock.lastCall as unknown as FetchCall;

afterEach(() => vi.unstubAllGlobals());

describe("api calls", () => {
  it("sends JSON with the write header and returns the parsed body", async () => {
    const fetch = respond({ card: { id: "c1" } });
    await expect(api.rename("c1", "New name")).resolves.toEqual({ card: { id: "c1" } });
    const [url, init] = lastCall(fetch);
    expect(url).toBe("/api/cards/c1");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "content-type": "application/json", "x-threadboard": "1" });
    expect(JSON.parse(init.body as string)).toEqual({ title: "New name" });
  });

  it("sends no body when there is none", async () => {
    const fetch = respond({ cards: [] });
    await api.list();
    expect(lastCall(fetch)[1].body).toBeUndefined();
  });

  it("throws the server's error message", async () => {
    respond({ error: "No such card." }, { status: 404, statusText: "Not Found" });
    await expect(api.stop("x")).rejects.toThrow("No such card.");
  });

  it("falls back to the status text when the error has no message", async () => {
    respond({}, { status: 500, statusText: "Internal Server Error" });
    await expect(api.copilot()).rejects.toThrow("Internal Server Error");
  });

  // Pins every route and payload the board relies on.
  const input: NewCardInput = { prompt: "p", cwd: "/w", backend: "claude", start: true };
  const cases: [string, () => Promise<unknown>, string, string, unknown][] = [
    ["list", () => api.list(), "GET", "/api/cards", undefined],
    ["create", () => api.create(input), "POST", "/api/cards", input],
    ["move", () => api.move("c1", "done"), "PATCH", "/api/cards/c1", { column: "done" }],
    ["setMode", () => api.setMode("c1", "auto"), "PATCH", "/api/cards/c1", { permissionMode: "auto" }],
    ["archive", () => api.archive("c1", true), "PATCH", "/api/cards/c1", { archived: true }],
    ["remove", () => api.remove("c1"), "DELETE", "/api/cards/c1", undefined],
    ["send", () => api.send("c1", "hi"), "POST", "/api/cards/c1/messages", { text: "hi" }],
    ["schedule", () => api.schedule("c1", "later", 123), "POST", "/api/cards/c1/scheduled", { text: "later", at: 123 }],
    ["unschedule", () => api.unschedule("c1", "m1"), "DELETE", "/api/cards/c1/scheduled", { messageId: "m1" }],
    ["answer", () => api.answer("c1", true, { q: "a" }, "p1"), "POST", "/api/cards/c1/permission", { allow: true, answers: { q: "a" }, pendingId: "p1" }],
    ["stop", () => api.stop("c1"), "POST", "/api/cards/c1/stop", undefined],
    ["release", () => api.release("c1"), "POST", "/api/cards/c1/release", undefined],
    ["devStatus", () => api.devStatus("c1"), "GET", "/api/cards/c1/dev", undefined],
    ["devAction", () => api.devAction("c1", "restart"), "POST", "/api/cards/c1/dev", { action: "restart" }],
    ["copilot", () => api.copilot(), "GET", "/api/copilot", undefined],
    ["resetCopilot", () => api.resetCopilot(), "POST", "/api/copilot/reset", undefined],
    ["settings", () => api.settings(), "GET", "/api/settings", undefined],
    ["saveSettings", () => api.saveSettings({ keepAliveMinutes: 5 }), "PATCH", "/api/settings", { keepAliveMinutes: 5 }],
    ["addProject", () => api.addProject("/p"), "POST", "/api/projects", { path: "/p" }],
    ["newProject", () => api.newProject("/dev", "app"), "POST", "/api/projects/new", { parent: "/dev", name: "app" }],
    ["removeProject", () => api.removeProject("/p"), "DELETE", "/api/projects", { path: "/p" }],
    ["loginStatus", () => api.loginStatus(), "GET", "/api/login", undefined],
    ["login", () => api.login("puku", "input", "code"), "POST", "/api/login", { backend: "puku", action: "input", text: "code" }],
    ["warm", () => api.warm({ cwd: "/w" }), "POST", "/api/warm", { cwd: "/w" }],
    ["newThreadPage", () => api.newThreadPage(), "POST", "/api/new-thread-page", {}],
    ["star", () => api.star("c1", "recipe"), "POST", "/api/library", { cardId: "c1", kind: "recipe", scope: "project" }],
    ["star mine", () => api.star("c1", "recipe", "mine"), "POST", "/api/library", { cardId: "c1", kind: "recipe", scope: "mine" }],
    ["updateLibraryItem", () => api.updateLibraryItem("i1", { title: "t" }), "PATCH", "/api/library/i1", { title: "t" }],
    ["removeLibraryItem", () => api.removeLibraryItem("i1"), "DELETE", "/api/library/i1", undefined],
    ["searchPrompts", () => api.searchPrompts("a&b c"), "GET", "/api/search?q=a%26b%20c", undefined],
    ["thread", () => api.thread("c1"), "GET", "/api/cards/c1/thread", undefined],
    ["skills", () => api.skills(), "GET", "/api/skills", undefined],
    ["skills in a folder", () => api.skills("/a b"), "GET", "/api/skills?cwd=%2Fa%20b", undefined],
    ["dictation", () => api.dictation(), "GET", "/api/transcribe", undefined],
    ["repos", () => api.repos(), "GET", "/api/repos", undefined],
    ["repos fresh", () => api.repos(true), "GET", "/api/repos?fresh=1", undefined],
    ["githubRepos", () => api.githubRepos(), "GET", "/api/repos/github", undefined],
    ["githubRepos fresh", () => api.githubRepos(true), "GET", "/api/repos/github?fresh=1", undefined],
    ["cloneRepo", () => api.cloneRepo("o/r"), "POST", "/api/repos/clone", { fullName: "o/r" }],
    ["library, mine only", () => api.library(), "GET", "/api/library?", undefined],
    ["library, one folder", () => api.library("/w x"), "GET", "/api/library?folder=%2Fw%20x", undefined],
    ["library, every project", () => api.library("/w", true), "GET", "/api/library?all=1", undefined],
  ];

  it.each(cases)("%s", async (_name, run, method, url, body) => {
    const fetch = respond({ ok: true });
    await run();
    const [gotUrl, init] = lastCall(fetch);
    expect(gotUrl).toBe(url);
    expect(init.method).toBe(method);
    expect(init.body === undefined ? undefined : JSON.parse(init.body as string)).toEqual(body);
  });
});

describe("api.transcribe", () => {
  it("posts the audio as is and returns the text", async () => {
    const fetch = respond({ text: "hello" });
    const audio = new Blob(["x"], { type: "audio/ogg" });
    await expect(api.transcribe(audio)).resolves.toBe("hello");
    const [url, init] = lastCall(fetch);
    expect(url).toBe("/api/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "x-threadboard": "1", "content-type": "audio/ogg" });
    expect(init.body).toBe(audio);
  });

  it("assumes webm for untyped audio, and empty text when none came back", async () => {
    const fetch = respond({});
    await expect(api.transcribe(new Blob(["x"]))).resolves.toBe("");
    expect((lastCall(fetch)[1].headers as Record<string, string>)["content-type"]).toBe("audio/webm");
  });

  it("throws the server's error, or the status text", async () => {
    respond({ error: "No model." }, { status: 503 });
    await expect(api.transcribe(new Blob(["x"]))).rejects.toThrow("No model.");
    respond({}, { status: 502, statusText: "Bad Gateway" });
    await expect(api.transcribe(new Blob(["x"]))).rejects.toThrow("Bad Gateway");
  });
});

describe("api.uploadAttachment", () => {
  class FakeXHR {
    static last: FakeXHR;
    method = "";
    url = "";
    headers: Record<string, string> = {};
    body: unknown;
    status = 0;
    responseText = "";
    upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    constructor() {
      FakeXHR.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: unknown) {
      this.body = body;
    }
    finish(status: number, responseText: string) {
      this.status = status;
      this.responseText = responseText;
      this.onload?.();
    }
  }

  beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXHR));

  const saved = { name: "a b.png", path: "/att/a.png", url: "/api/attachments/a.png", kind: "image", bytes: 3 };

  it("posts the file with its name and type, and resolves to the saved attachment", async () => {
    const file = new Blob(["abc"], { type: "image/png" });
    const done = api.uploadAttachment(file, "a b.png");
    const xhr = FakeXHR.last;
    expect([xhr.method, xhr.url]).toEqual(["POST", "/api/attachments"]);
    expect(xhr.headers).toEqual({ "x-threadboard": "1", "x-filename": "a%20b.png", "content-type": "image/png" });
    expect(xhr.body).toBe(file);
    xhr.finish(200, JSON.stringify(saved));
    await expect(done).resolves.toEqual(saved);
  });

  it("sends an untyped file as octet-stream", () => {
    void api.uploadAttachment(new Blob(["x"]), "f");
    expect(FakeXHR.last.headers["content-type"]).toBe("application/octet-stream");
  });

  it("reports progress only when the size is known", () => {
    const onProgress = vi.fn();
    void api.uploadAttachment(new Blob(["x"]), "f", onProgress);
    const progress = FakeXHR.last.upload.onprogress!;
    progress({ lengthComputable: false, loaded: 1, total: 0 });
    progress({ lengthComputable: true, loaded: 25, total: 100 });
    expect(onProgress.mock.calls).toEqual([[0.25]]);
    // No callback is fine too.
    void api.uploadAttachment(new Blob(["x"]), "f");
    expect(() => FakeXHR.last.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 2 })).not.toThrow();
  });

  it("rejects with the server's error", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.finish(413, JSON.stringify({ error: "Too big." }));
    await expect(done).rejects.toThrow("Too big.");
  });

  it("rejects with the status when the reply isn't JSON", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.finish(502, "<html>");
    await expect(done).rejects.toThrow("Upload failed (502).");
  });

  it("rejects a 2xx reply with no saved path", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.finish(200, "{}");
    await expect(done).rejects.toThrow("Upload failed (200).");
  });

  it("rejects a 1xx status even with a path", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.finish(101, JSON.stringify(saved));
    await expect(done).rejects.toThrow("Upload failed (101).");
  });

  it("rejects on a network error", async () => {
    const done = api.uploadAttachment(new Blob(["x"]), "f");
    FakeXHR.last.onerror!();
    await expect(done).rejects.toThrow("Upload failed.");
  });
});

describe("mergeThread", () => {
  const item = (text: string) => ({ kind: "text", text }) as unknown as ThreadItem;

  it("lays live items over the snapshot by index and keeps the rest", () => {
    const live: ThreadItem[] = [];
    live[1] = item("live 1");
    live[3] = item("live 3");
    expect(mergeThread([item("a"), item("b"), item("c")], live)).toEqual([item("a"), item("live 1"), item("c"), item("live 3")]);
  });

  it("doesn't change the snapshot it was given", () => {
    const snapshot = [item("a")];
    mergeThread(snapshot, [item("b")]);
    expect(snapshot).toEqual([item("a")]);
  });
});
