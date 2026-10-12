// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBuildError, useBuildError } from "./build-error";

function overlay(label: string, desc: string, frame = "") {
  const host = document.createElement("div");
  host.innerHTML = `<span id="nextjs__container_errors_label">${label}</span>
    <p id="nextjs__container_errors_desc">${desc}</p><pre>${frame}</pre>`;
  return host;
}

describe("readBuildError", () => {
  it("reads the message and the file from a Build Error overlay", () => {
    const root = overlay("Build Error", " Unexpected token. ", "./components/Board.tsx (1000:1) Error: …");
    expect(readBuildError(root)).toEqual({ message: "Unexpected token.", file: "./components/Board.tsx (1000:1)" });
  });

  it("falls back when the overlay names no message or file", () => {
    expect(readBuildError(overlay("Build Error", ""))).toEqual({ message: "The build failed", file: null });
  });

  it("ignores runtime errors and a missing overlay", () => {
    expect(readBuildError(overlay("Runtime Error", "x is undefined"))).toBeNull();
    expect(readBuildError(document.createElement("div"))).toBeNull();
    expect(readBuildError(null)).toBeNull();
  });
});

describe("useBuildError", () => {
  let portal: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
    portal = document.createElement("nextjs-portal");
    portal.attachShadow({ mode: "open" });
    document.body.append(portal);
  });
  afterEach(() => {
    portal.remove();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("follows the overlay and marks <html> while a build error shows", () => {
    const { result } = renderHook(() => useBuildError());
    expect(result.current).toBeNull();
    expect(document.documentElement.dataset.buildError).toBeUndefined();

    portal.shadowRoot!.append(overlay("Build Error", "Unexpected token.", "./a.tsx (1:1)"));
    act(() => void vi.advanceTimersByTime(1000));
    const first = result.current;
    expect(first).toEqual({ message: "Unexpected token.", file: "./a.tsx (1:1)" });
    expect(document.documentElement.dataset.buildError).toBe("");

    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(first);

    portal.shadowRoot!.replaceChildren();
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBeNull();
    expect(document.documentElement.dataset.buildError).toBeUndefined();
  });

  it("does nothing outside dev mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    portal.shadowRoot!.append(overlay("Build Error", "Unexpected token."));
    const { result } = renderHook(() => useBuildError());
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBeNull();
  });
});
