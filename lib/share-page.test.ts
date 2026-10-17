import { describe, expect, it } from "vitest";
import { isTextType, pageContentType } from "./share-page";

describe("pageContentType", () => {
  it("puts HTML back when Storage serves it as text/plain, or with no type", () => {
    expect(pageContentType("text/plain;charset=UTF-8", "<!doctype html><html>")).toBe("text/html; charset=utf-8");
    expect(pageContentType("text/plain", "  \n<!DOCTYPE HTML>")).toBe("text/html; charset=utf-8");
    expect(pageContentType("", "<html lang=\"en\">")).toBe("text/html; charset=utf-8");
    expect(pageContentType("application/octet-stream", "﻿<html>")).toBe("text/html; charset=utf-8");
  });

  it("leaves plain text that only looks a little like HTML alone", () => {
    expect(pageContentType("text/plain", "notes about <html> tags")).toBe("text/plain; charset=utf-8");
    expect(pageContentType("text/plain", "<htmlish>")).toBe("text/plain; charset=utf-8");
  });

  it("declares a charset on text types that lack one, and keeps one that has it", () => {
    expect(pageContentType("text/html", "<p>")).toBe("text/html; charset=utf-8");
    expect(pageContentType("text/css", "a{}")).toBe("text/css; charset=utf-8");
    expect(pageContentType("text/html; charset=iso-8859-1", "<p>")).toBe("text/html; charset=iso-8859-1");
  });

  it("passes other types through, and names an unknown binary", () => {
    expect(pageContentType("image/png", "\u0089PNG")).toBe("image/png");
    expect(pageContentType("application/pdf", "%PDF")).toBe("application/pdf");
    expect(pageContentType("", "\u0001\u0002")).toBe("application/octet-stream");
  });
});

describe("isTextType", () => {
  it("is true for text/* only", () => {
    expect(isTextType("text/html; charset=utf-8")).toBe(true);
    expect(isTextType("TEXT/PLAIN")).toBe(true);
    expect(isTextType("image/png")).toBe(false);
    expect(isTextType("application/octet-stream")).toBe(false);
  });
});
