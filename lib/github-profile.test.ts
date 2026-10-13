import { beforeEach, describe, expect, it, vi } from "vitest";

const gh = vi.hoisted((): { result: string | Error; calls: number } => ({ result: "", calls: 0 }));

vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string }) => void) => {
    gh.calls++;
    if (gh.result instanceof Error) cb(gh.result);
    else cb(null, { stdout: gh.result });
  },
}));

const { cachedGithubProfile, githubProfile, parseProfile, MISS_TTL, PROFILE_TTL } = await import("./github-profile");

const USER = {
  login: "fotoflo",
  name: "Alex Miller",
  bio: " Serial Entrepreneur ",
  avatar_url: "https://avatars.githubusercontent.com/u/1",
  html_url: "https://github.com/fotoflo",
  company: "@aimhuge",
  location: "Bali, Indonesia",
  blog: "aimhuge.com",
  followers: 23,
  public_repos: 71,
};

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__weftGithubProfile;
  gh.calls = 0;
  gh.result = JSON.stringify(USER);
});

describe("parseProfile", () => {
  it("reads gh's user JSON", () => {
    expect(parseProfile(JSON.stringify(USER))).toEqual({
      login: "fotoflo",
      name: "Alex Miller",
      bio: "Serial Entrepreneur",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      url: "https://github.com/fotoflo",
      company: "aimhuge",
      location: "Bali, Indonesia",
      blog: "https://aimhuge.com",
      followers: 23,
      publicRepos: 71,
    });
  });

  it("fills gaps and keeps a full blog url", () => {
    expect(parseProfile(JSON.stringify({ login: "ada", name: "", blog: "http://ada.dev" }))).toEqual({
      login: "ada",
      name: null,
      bio: null,
      avatarUrl: null,
      url: "https://github.com/ada",
      company: null,
      location: null,
      blog: "http://ada.dev",
      followers: 0,
      publicRepos: 0,
    });
  });

  it("refuses what isn't a user", () => {
    expect(parseProfile("not json")).toBeNull();
    expect(parseProfile("null")).toBeNull();
    expect(parseProfile(JSON.stringify({ message: "Bad credentials" }))).toBeNull();
  });
});

describe("githubProfile", () => {
  it("asks gh once and keeps the profile for hours", async () => {
    expect(cachedGithubProfile()).toBeNull();
    expect((await githubProfile(1000))?.login).toBe("fotoflo");
    expect((await githubProfile(1000 + PROFILE_TTL - 1))?.login).toBe("fotoflo");
    expect(gh.calls).toBe(1);
    expect(cachedGithubProfile()?.name).toBe("Alex Miller");
    await githubProfile(1000 + PROFILE_TTL);
    expect(gh.calls).toBe(2);
  });

  it("keeps the last profile when gh fails, and retries a miss sooner", async () => {
    await githubProfile(1000);
    gh.result = new Error("offline");
    expect((await githubProfile(1000 + PROFILE_TTL))?.login).toBe("fotoflo");
    delete (globalThis as Record<string, unknown>).__weftGithubProfile;
    expect(await githubProfile(1000)).toBeNull();
    expect(await githubProfile(1000 + MISS_TTL - 1)).toBeNull();
    expect(gh.calls).toBe(3);
    gh.result = JSON.stringify(USER);
    expect((await githubProfile(1000 + MISS_TTL))?.login).toBe("fotoflo");
  });
});
