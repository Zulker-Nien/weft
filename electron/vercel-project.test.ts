import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deploymentOf, frameworkOf, gitOf, ignoreVercel, productionUrl, PROJECT_NAME, readLink, repoOf, request } from "./vercel-project.cjs";

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe("reading Vercel's answers", () => {
  it("reads deployments, GitHub links and production urls", () => {
    expect(deploymentOf(null)).toBeNull();
    expect(deploymentOf({ url: "x.vercel.app", state: "ERROR", created: 3 })).toEqual({ state: "ERROR", url: "https://x.vercel.app", createdAt: 3, target: null, page: null });
    expect(deploymentOf({})).toEqual({ state: "UNKNOWN", url: null, createdAt: 0, target: null, page: null });
    expect(deploymentOf({ inspectorUrl: "https://vercel.com/a/b/c" })?.page).toBe("https://vercel.com/a/b/c");
    expect(gitOf({ link: { type: "github", org: "o", repo: "r" } })).toBe("o/r");
    expect(gitOf({ link: { type: "github", repo: "o/r" } })).toBe("o/r");
    expect(gitOf({ link: { type: "github" } })).toBeNull();
    expect(gitOf({ link: { type: "gitlab", org: "o", repo: "r" } })).toBeNull();
    expect(gitOf({})).toBeNull();
    expect(productionUrl({ targets: { production: { alias: ["web.example.com"] } } })).toBe("https://web.example.com");
    expect(productionUrl({ alias: [{ domain: "a.dev" }] })).toBe("https://a.dev");
    expect(productionUrl({ targets: { production: { url: "p.vercel.app" } } })).toBe("https://p.vercel.app");
    expect(productionUrl({})).toBeNull();
  });

  it("builds a GET with the team and query, or a JSON POST", () => {
    const get = request("/v6/deployments", { auth: "t", teamId: "team_a", query: { limit: 1 } });
    expect(String(get.url)).toBe("https://api.vercel.com/v6/deployments?teamId=team_a&limit=1");
    expect(get.init).toEqual({ method: "GET", headers: { Authorization: "Bearer t" }, body: undefined });
    const post = request("/v11/projects", { auth: "t", method: "POST", body: { name: "x" } });
    expect(post.init).toEqual({ method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: '{"name":"x"}' });
  });
});

describe("the folder's side", () => {
  it("reads a link file and ignores a broken one", () => {
    const dir = tmp("weft-proj-");
    expect(readLink(dir)).toBeNull();
    fs.mkdirSync(path.join(dir, ".vercel"));
    fs.writeFileSync(path.join(dir, ".vercel/project.json"), JSON.stringify({ projectId: 1 }));
    expect(readLink(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, ".vercel/project.json"), JSON.stringify({ projectId: "p", orgId: "o" }));
    expect(readLink(dir)).toEqual({ projectId: "p", orgId: "o" });
  });

  it("adds .vercel to .gitignore once", () => {
    const dir = tmp("weft-proj-");
    ignoreVercel(dir);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe(".vercel\n");
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules");
    ignoreVercel(dir);
    ignoreVercel(dir);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("node_modules\n.vercel\n");
    fs.writeFileSync(path.join(dir, ".gitignore"), "/.vercel/\n");
    ignoreVercel(dir);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("/.vercel/\n");
  });

  it("reads the framework from package.json", () => {
    const dir = tmp("weft-proj-");
    expect(frameworkOf(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ devDependencies: { vite: "7" } }));
    expect(frameworkOf(dir)).toBe("vite");
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { "@sveltejs/kit": "2" }, devDependencies: { vite: "7" } }));
    expect(frameworkOf(dir)).toBe("sveltekit");
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "plain" }));
    expect(frameworkOf(dir)).toBeNull();
    expect(PROJECT_NAME.test("my-app.v2_x")).toBe(true);
  });

  it("reads a GitHub repo from the remote", async () => {
    expect(await repoOf("/x", () => Promise.resolve("git@github.com:Me/Web.git"))).toBe("Me/Web");
    expect(await repoOf("/x", () => Promise.resolve("https://gitlab.com/me/web"))).toBeNull();
    expect(await repoOf("/x", () => Promise.resolve(null))).toBeNull();
    expect(await repoOf(os.tmpdir())).toBeNull();
  });
});
