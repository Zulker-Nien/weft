import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bashWrites } from "./bash-writes";

const DIR = "/Users/me/dev/weft";
const writes = (command: string, cwd = DIR) => bashWrites(command, cwd);

describe("bashWrites", () => {
  it("names what > and >> write, absolute", () => {
    expect(writes("echo hi > a.txt")).toEqual([`${DIR}/a.txt`]);
    expect(writes("echo hi >> notes/b.md")).toEqual([`${DIR}/notes/b.md`]);
    expect(writes("cat > out.txt < in.txt")).toEqual([`${DIR}/out.txt`]);
    expect(writes("cat >> b.md <<EOF\nbody\nEOF")).toEqual([`${DIR}/b.md`]);
    expect(writes("cat > a.txt > b.txt")).toEqual([`${DIR}/a.txt`, `${DIR}/b.txt`]);
  });

  it("writes into the folder a cd moved to", () => {
    expect(writes("cd lib && cat > a.ts")).toEqual([`${DIR}/lib/a.ts`]);
    expect(writes("cd lib && cd deep && rm a")).toEqual([`${DIR}/lib/deep/a`]);
    expect(writes("cd ../weft && touch a")).toEqual([`${DIR}/a`]);
  });

  it("leaves /dev/null and a fd copy out of it", () => {
    expect(writes("echo hi >/dev/null")).toEqual([]);
    expect(writes("cmd 2> /dev/null")).toEqual([]);
    expect(writes("echo hi 2>&1 > a.txt")).toEqual([`${DIR}/a.txt`]);
    expect(writes("cmd &> /dev/null 2>&1")).toEqual([]);
    expect(writes("echo x > /dev/stderr")).toEqual([]);
  });

  it("takes sed's file only when it edits in place", () => {
    expect(writes("sed -i 's/a/b/' file.txt")).toEqual([`${DIR}/file.txt`]);
    expect(writes("sed -i -e 's/a/b/' file.txt")).toEqual([`${DIR}/file.txt`]);
    expect(writes("sed --in-place 's/a/b/' file.txt")).toEqual([`${DIR}/file.txt`]);
    expect(writes("sed --in-place=.bak 's/a/b/' file.txt")).toEqual([`${DIR}/file.txt`]);
    expect(writes("sed 's/a/b/' file.txt")).toEqual([]);
    expect(writes("sed -f fix.sed file.txt")).toEqual([]);
    expect(writes("sed -i -f fix.sed file.txt")).toEqual([`${DIR}/file.txt`]);
  });

  it("skips BSD sed's empty backup suffix, which is not a file", () => {
    expect(writes("sed -i '' 's/a/b/' file.txt")).toEqual([`${DIR}/file.txt`]);
    expect(writes("sed -i '' -e 's/a/b/' file.txt")).toEqual([`${DIR}/file.txt`]);
  });

  it("takes perl's file only under -i", () => {
    expect(writes("perl -pi -e 's/a/b/' f")).toEqual([`${DIR}/f`]);
    expect(writes("perl -i -pe 's/a/b/' f")).toEqual([`${DIR}/f`]);
    expect(writes("perl -E -i -e 's/a/b/' f")).toEqual([`${DIR}/f`]);
    expect(writes("perl -pe 's/a/b/' f")).toEqual([]);
  });

  it("takes every file argument of tee, touch, rm and mv", () => {
    expect(writes("tee out.txt")).toEqual([`${DIR}/out.txt`]);
    expect(writes("tee -a out.txt log.txt")).toEqual([`${DIR}/out.txt`, `${DIR}/log.txt`]);
    expect(writes("touch new.txt")).toEqual([`${DIR}/new.txt`]);
    expect(writes("rm -rf a b")).toEqual([`${DIR}/a`, `${DIR}/b`]);
    expect(writes("mv a b")).toEqual([`${DIR}/a`, `${DIR}/b`]);
  });

  it("takes only the destination of a cp", () => {
    expect(writes("cp a b")).toEqual([`${DIR}/b`]);
    expect(writes("cp -R src/. dest/")).toEqual([`${DIR}/dest`]);
    expect(writes("cp a b c")).toEqual([`${DIR}/c`]);
  });

  it("takes files only when prettier or eslint were told to change them", () => {
    expect(writes("prettier --write src")).toEqual([`${DIR}/src`]);
    expect(writes("prettier -w src")).toEqual([`${DIR}/src`]);
    expect(writes("prettier --check src")).toEqual([]);
    expect(writes("prettier src")).toEqual([]);
    expect(writes("eslint --fix src")).toEqual([`${DIR}/src`]);
    expect(writes("eslint src")).toEqual([]);
    expect(writes("eslint --fix --ext .ts lib")).toEqual([`${DIR}/lib`]);
  });

  it("sees through npx, pnpm exec and a direct pnpm script", () => {
    expect(writes("npx prettier --write src")).toEqual([`${DIR}/src`]);
    expect(writes("pnpx prettier --write src")).toEqual([`${DIR}/src`]);
    expect(writes("bunx prettier --write src")).toEqual([`${DIR}/src`]);
    expect(writes("pnpm exec prettier --write src")).toEqual([`${DIR}/src`]);
    expect(writes("pnpm dlx eslint --fix src")).toEqual([`${DIR}/src`]);
    expect(writes("pnpm prettier --write src")).toEqual([`${DIR}/src`]);
    expect(writes("yarn x prettier --write src")).toEqual([`${DIR}/src`]);
    expect(writes("bun x prettier --write src")).toEqual([`${DIR}/src`]);
    expect(writes("pnpm run build")).toEqual([]);
    expect(writes("npx")).toEqual([]);
  });

  it("takes the tool's own name off a path, and an absolute cwd", () => {
    expect(writes("npx ./node_modules/.bin/prettier --write src")).toEqual([`${DIR}/src`]);
    expect(writes("/usr/local/bin/rm a", "/tmp/work")).toEqual(["/tmp/work/a"]);
  });

  it("expands a leading ~", () => {
    expect(writes("echo hi > ~/notes.md")).toEqual([path.join(os.homedir(), "notes.md")]);
    expect(writes("cd ~ && touch a")).toEqual([path.join(os.homedir(), "a")]);
    expect(writes("rm ~/notes.md")).toEqual([path.join(os.homedir(), "notes.md")]);
  });

  it("says nothing for a command that only reads", () => {
    expect(writes("ls -la")).toEqual([]);
    expect(writes("git status")).toEqual([]);
    expect(writes("grep -r foo .")).toEqual([]);
    expect(writes("")).toEqual([]);
    expect(writes("")).toEqual([]);
  });

  it("names a file once, however it's written", () => {
    expect(writes("cat > a.txt && touch a.txt")).toEqual([`${DIR}/a.txt`]);
    expect(writes("sed -i 's/a/b/' f && tee f")).toEqual([`${DIR}/f`]);
  });

  it("finds writes inside a shell's script, a substitution and a heredoc", () => {
    expect(writes("bash -c 'cat > a.txt'")).toEqual([`${DIR}/a.txt`]);
    expect(writes("echo $(rm a)")).toEqual([`${DIR}/a`]);
    expect(writes("bash <<EOF\nrm a\nEOF")).toEqual([`${DIR}/a`]);
    expect(writes("echo `touch b`")).toEqual([`${DIR}/b`]);
  });
});