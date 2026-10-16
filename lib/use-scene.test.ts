// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useScene } from "./use-scene";

afterEach(() => {
  document.documentElement.dataset.scene = "";
  document.documentElement.dataset.theme = "";
});

describe("useScene", () => {
  it("returns the current scene from the document", () => {
    document.documentElement.dataset.scene = "salt-flats";
    document.documentElement.dataset.theme = "light";
    const { result } = renderHook(() => useScene());
    expect(result.current.id).toBe("salt-flats");
  });

  it("follows a scene change", async () => {
    document.documentElement.dataset.scene = "salt-flats";
    document.documentElement.dataset.theme = "light";
    const { result } = renderHook(() => useScene());
    expect(result.current.id).toBe("salt-flats");
    act(() => {
      document.documentElement.dataset.scene = "twin-suns";
      document.documentElement.dataset.theme = "dark";
    });
    await waitFor(() => expect(result.current.id).toBe("twin-suns"));
  });
});