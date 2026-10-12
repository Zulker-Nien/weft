import { describe, expect, it } from "vitest";
import { argvLink } from "./argv-link.cjs";

describe("argvLink", () => {
  it("returns the weft:// arg when the wrapper passes it raw", () => {
    expect(argvLink(["/path/to/Electron", "/path/to/project", "weft://account-callback?code=abc"])).toBe("weft://account-callback?code=abc");
  });

  it("returns the value behind --weft-link= when the wrapper uses the explicit form", () => {
    expect(argvLink(["/path/to/Electron", "--weft-link=weft://card/123"])).toBe("weft://card/123");
  });

  it("prefers a raw arg over --weft-link= when both are present", () => {
    expect(
      argvLink(["/path/to/Electron", "weft://account-callback?code=a", "--weft-link=weft://card/b"]),
    ).toBe("weft://account-callback?code=a");
  });

  it("returns null when no link is in argv", () => {
    expect(argvLink(["/path/to/Electron", "/path/to/project"])).toBeNull();
    expect(argvLink([])).toBeNull();
    expect(argvLink(undefined)).toBeNull();
  });

  it("ignores non-weft:// URLs and malformed --weft-link values", () => {
    expect(argvLink(["https://example.com/x"])).toBeNull();
    expect(argvLink(["--weft-link"])).toBeNull();
    expect(argvLink(["--weft-link="])).toBeNull();
  });
});
