// lib/auth/identity.ts: read a display identity off a Supabase user.
// Mirrors @aimhuge/auth's `identityFromUser`; GitHub lands user_name /
// avatar_url, magic links land name / email.
import { describe, expect, it } from "vitest";
import { identityFromUser } from "./identity";

function user(meta: Record<string, unknown>, email: string | null = null) {
  return {
    id: "u1",
    email,
    user_metadata: meta,
    app_metadata: {},
    aud: "authenticated",
    created_at: "",
  } as unknown as Parameters<typeof identityFromUser>[0];
}

describe("identityFromUser", () => {
  it("reads GitHub's user_name + avatar_url", () => {
    expect(identityFromUser(user({ user_name: "fotoflo", avatar_url: "https://avatars/1" }, "alex@aimhuge.com"))).toEqual({
      name: "fotoflo",
      avatarUrl: "https://avatars/1",
      email: "alex@aimhuge.com",
    });
  });

  it("falls back to full_name when user_name is missing", () => {
    expect(identityFromUser(user({ full_name: "Alex Miller" }))).toEqual({
      name: "Alex Miller",
      avatarUrl: null,
      email: null,
    });
  });

  it("falls back to name when nothing else is set", () => {
    expect(identityFromUser(user({ name: "Alex" }))).toEqual({
      name: "Alex",
      avatarUrl: null,
      email: null,
    });
  });

  it("ignores empty strings", () => {
    expect(identityFromUser(user({ user_name: "", avatar_url: "" }))).toEqual({
      name: null,
      avatarUrl: null,
      email: null,
    });
  });

  it("returns nulls for a user with no metadata", () => {
    expect(identityFromUser(user({}))).toEqual({ name: null, avatarUrl: null, email: null });
  });
});
