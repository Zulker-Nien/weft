import { describe, expect, it } from "vitest";
import { randomSecret, SECRET_ALPHABET } from "./random-secret";

describe("randomSecret", () => {
  it("makes 40 letters and digits by default", () => {
    const value = randomSecret();
    expect(value).toHaveLength(40);
    expect(value).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("takes a length", () => {
    expect(randomSecret(12)).toHaveLength(12);
  });

  it("differs each time", () => {
    expect(randomSecret()).not.toBe(randomSecret());
  });

  it("drops bytes from 248 up and fills again until it has enough", () => {
    let call = 0;
    const fill = (bytes: Uint8Array) => {
      call++;
      // The first fill is all out-of-range bytes, the second maps to the alphabet in order.
      bytes.forEach((_, i) => (bytes[i] = call === 1 ? 250 : i));
    };
    expect(randomSecret(4, fill)).toBe(SECRET_ALPHABET.slice(0, 4));
    expect(call).toBe(2);
  });
});
