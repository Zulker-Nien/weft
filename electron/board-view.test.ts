// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BLANK_SECRETS_CSS, OPERATIONS, REDACTED, boardViewRoutes, createBoardView, scripts } from "./board-view.cjs";

// A stand-in for the board's webContents: page scripts really run, in happy-dom's document.
function fakeBoard({ url = "http://localhost:1000/", empty = false, width = 1200 } = {}) {
  const ran: string[] = [];
  const image = {
    isEmpty: () => empty,
    getSize: () => ({ width }),
    resize: vi.fn(() => image),
    toPNG: () => Buffer.from("png"),
  };
  const wc = {
    ran,
    image,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    getURL: () => url,
    getTitle: () => "Weft",
    getZoomFactor: () => 1.25,
    executeJavaScript: vi.fn((script: string): Promise<unknown> => {
      ran.push(script);
      return Promise.resolve((0, eval)(script) as unknown);
    }),
    insertCSS: vi.fn(() => Promise.resolve("css-1")),
    removeInsertedCSS: vi.fn(() => Promise.resolve()),
    capturePage: vi.fn(() => Promise.resolve(image)),
    sendInputEvent: vi.fn(),
    insertText: vi.fn(() => Promise.resolve()),
  };
  return wc;
}

let wc: ReturnType<typeof fakeBoard>;
let view: ReturnType<typeof createBoardView>;
beforeEach(() => {
  document.body.innerHTML = "";
  wc = fakeBoard();
  view = createBoardView({ board: () => wc });
});

describe("the operation allowlist", () => {
  it("serves exactly screenshot, click, hover, type and read, nothing that runs JS", () => {
    expect(OPERATIONS).toEqual(["screenshot", "click", "hover", "type", "read"]);
    expect(Object.keys(boardViewRoutes(view))).toEqual(OPERATIONS.map((op: string) => `POST /board-view/${op}`));
  });

  it("each route calls its operation with the body's fields", () => {
    const fake = { screenshot: vi.fn(), click: vi.fn(), hover: vi.fn(), type: vi.fn(), read: vi.fn() };
    const routes = boardViewRoutes(fake);
    routes["POST /board-view/screenshot"]({ highlight: "h", js: "x" });
    routes["POST /board-view/click"]({ selector: "a" });
    routes["POST /board-view/hover"]({ selector: "b" });
    routes["POST /board-view/type"]({ selector: "c", text: "t" });
    routes["POST /board-view/read"]({ selector: "d" });
    expect(fake.screenshot).toHaveBeenCalledWith("h");
    expect(fake.click).toHaveBeenCalledWith("a");
    expect(fake.hover).toHaveBeenCalledWith("b");
    expect(fake.type).toHaveBeenCalledWith("c", "t");
    expect(fake.read).toHaveBeenCalledWith("d");
  });

  it("a selector is data, never code: one that tries to break out of its string is just a selector", async () => {
    (window as unknown as { pwned?: boolean }).pwned = false;
    const evil = `"); window.pwned = true; ("`;
    await expect(view.click(evil)).rejects.toThrow();
    expect((window as unknown as { pwned?: boolean }).pwned).toBe(false);
    for (const make of [scripts.click, scripts.read, scripts.locate, scripts.focusField, scripts.highlight]) {
      expect(make(evil)).toContain(JSON.stringify(evil));
    }
  });

  it("wants a selector, and a short one", async () => {
    await expect(view.click("  ")).rejects.toThrow(/selector is required/);
    await expect(view.hover(undefined as unknown as string)).rejects.toThrow(/selector is required/);
    await expect(view.type("x".repeat(501), "t")).rejects.toThrow(/too long/);
  });

  it("says so when the board isn't there or hasn't loaded", async () => {
    await expect(createBoardView({ board: () => undefined }).read()).rejects.toThrow(/isn't loaded/);
    wc.destroyed = true;
    await expect(view.read()).rejects.toThrow(/isn't loaded/);
    await expect(createBoardView({ board: () => fakeBoard({ url: "" }) }).read()).rejects.toThrow(/isn't loaded/);
  });
});

describe("secret values", () => {
  beforeEach(() => {
    document.body.innerHTML = `<section id="drawer"><span>API_KEY</span><div data-secret>sk-live-123</div>
      <input id="value" data-secret value="typed-secret"><p id="echo">copy of sk-live-123 here</p>
      <button id="reveal" data-secret-action="eye"><i id="eye">eye</i></button><button id="copy" data-secret-action="copy">copy</button></section>`;
  });

  it("read cuts every data-secret value out of the text, wherever it shows up", async () => {
    const page = await view.read();
    expect(page.text).not.toContain("sk-live-123");
    expect(page.text).toContain(REDACTED);
    expect(page).toMatchObject({ url: "http://localhost:1000/", title: "Weft" });
    expect((await view.read("#echo")).text).toBe(`copy of ${REDACTED} here`);
  });

  it("reading a data-secret element itself gives only ‹secret›", async () => {
    expect((await view.read("[data-secret]")).text).toBe(REDACTED);
  });

  it("won't click reveal or copy, or anything inside them", async () => {
    const clicked = vi.fn();
    document.getElementById("reveal")!.addEventListener("click", clicked);
    await expect(view.click("#reveal")).rejects.toThrow(/reveals or copies a secret/);
    await expect(view.click("#eye")).rejects.toThrow(/reveals or copies/);
    await expect(view.click("#copy")).rejects.toThrow(/reveals or copies/);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("screenshots blank data-secret for the capture and take the blanking off after", async () => {
    await view.screenshot();
    expect(wc.insertCSS).toHaveBeenCalledWith(BLANK_SECRETS_CSS);
    expect(BLANK_SECRETS_CSS).toContain("[data-secret]");
    expect(BLANK_SECRETS_CSS).toMatch(/color: transparent/);
    expect(wc.insertCSS.mock.invocationCallOrder[0]).toBeLessThan(wc.capturePage.mock.invocationCallOrder[0]!);
    expect(wc.removeInsertedCSS).toHaveBeenCalledWith("css-1");
  });

  it("takes the blanking off even when the capture fails", async () => {
    wc.capturePage.mockRejectedValueOnce(new Error("gone"));
    await expect(view.screenshot()).rejects.toThrow("gone");
    expect(wc.removeInsertedCSS).toHaveBeenCalledWith("css-1");
  });
});

describe("operations", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="go">Go</button><input id="name"><div id="note" contenteditable>hi</div><div id="plain">text</div>`;
  });

  it("click clicks the element, and a miss is an error naming the selector", async () => {
    const clicked = vi.fn();
    document.getElementById("go")!.addEventListener("click", clicked);
    expect(await view.click("#go")).toEqual({ clicked: "#go" });
    expect(clicked).toHaveBeenCalledOnce();
    await expect(view.click("#nope")).rejects.toThrow("No element on the board matches #nope");
  });

  it("hover moves the real mouse to the element's middle, scaled by the zoom", async () => {
    const el = document.getElementById("go")!;
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 40, height: 20 }) as DOMRect;
    expect(await view.hover("#go")).toEqual({ hovered: "#go", x: 38, y: 38 });
    expect(wc.sendInputEvent).toHaveBeenCalledWith({ type: "mouseMove", x: 38, y: 38 });
    await expect(view.hover("#nope")).rejects.toThrow(/matches #nope/);
  });

  it("type focuses a field, selects it and types, and refuses what isn't a field", async () => {
    // happy-dom has no execCommand; Chromium selects a contenteditable's contents with it.
    const exec = vi.fn();
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await view.type("#name", "hello")).toEqual({ typed: "#name" });
    expect(document.activeElement?.id).toBe("name");
    expect(wc.insertText).toHaveBeenCalledWith("hello");
    expect(await view.type("#note", "x")).toEqual({ typed: "#note" });
    expect(exec).toHaveBeenCalledWith("selectAll");
    await view.type("#name", undefined);
    expect(wc.insertText).toHaveBeenLastCalledWith("");
    await expect(view.type("#plain", "x")).rejects.toThrow(/isn't a text field/);
    await expect(view.type("#go", "x")).rejects.toThrow(/isn't a text field/);
    await expect(view.type("#nope", "x")).rejects.toThrow(/matches #nope/);
  });

  it("read gives the whole board, or one element, and a miss is an error", async () => {
    expect((await view.read()).text).toContain("Go");
    expect((await view.read("#plain")).text).toBe("text");
    await expect(view.read("#nope")).rejects.toThrow(/matches #nope/);
  });

  it("screenshot answers a PNG, boxes a highlight and takes the box away", async () => {
    const shot = await view.screenshot("#go");
    expect(shot).toEqual({ png: Buffer.from("png").toString("base64"), found: true });
    expect(wc.ran.some((s) => s.includes("__weft_board_highlight") && s.includes("appendChild"))).toBe(true);
    expect(document.getElementById("__weft_board_highlight")).toBeNull();
    expect(await view.screenshot("#nope")).toMatchObject({ found: false });
    expect(await view.screenshot()).not.toHaveProperty("found");
  });

  it("screenshot shrinks a wide capture and says so when the window captures empty", async () => {
    wc = fakeBoard({ width: 3000 });
    await createBoardView({ board: () => wc }).screenshot();
    expect(wc.image.resize).toHaveBeenCalledWith({ width: 1600 });
    wc = fakeBoard({ empty: true });
    await expect(createBoardView({ board: () => wc }).screenshot()).rejects.toThrow(/captured empty/);
  });

  it("a failed un-highlight or CSS removal doesn't hide the shot", async () => {
    wc.removeInsertedCSS.mockRejectedValueOnce(new Error("x"));
    const real = wc.executeJavaScript.getMockImplementation()!;
    wc.executeJavaScript.mockImplementation((s: string) => (s.includes("?.remove()") ? Promise.reject(new Error("y")) : real(s)));
    expect(await view.screenshot("#go")).toMatchObject({ found: true });
  });
});
