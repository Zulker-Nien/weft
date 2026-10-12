import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Safety net: tests never see the real ~/.weft or ~/.claude. Files that need clean state set their own
// THREADBOARD_DATA (and HOME) to a fresh temp dir before importing the module under test.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "weft-test-"));

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    // Component tests opt into jsdom per file (`// @vitest-environment jsdom`); everything else stays on node.
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.tsx", "electron/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    env: {
      THREADBOARD_DATA: path.join(sandbox, "data"),
      CLAUDE_CONFIG_DIR: path.join(sandbox, "claude"),
      HOME: path.join(sandbox, "home"),
    },
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      // Test files, and the shared fakes they import (lib/runner.harness.ts).
      exclude: ["**/*.test.ts", "**/*.harness.ts"],
      reporter: ["text-summary", "text", "json-summary"],
    },
  },
});
