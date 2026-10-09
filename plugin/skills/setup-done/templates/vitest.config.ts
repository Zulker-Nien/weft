import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "dist/**"],
    coverage: { provider: "v8", reporter: ["text-summary", "html"] },
  },
});
