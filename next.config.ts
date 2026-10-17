import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // NEXT_PUBLIC_SITE_URL is where @aimhuge/teams points invite links (its siteOrigin()); it's inlined at build.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || "https://weft.zip" },
  // `pnpm app` builds into its own folder so it never collides with a running dev server.
  distDir: process.env.THREADBOARD_DIST || ".next",
  // `pnpm dist` builds a self-contained server that the packaged Weft.app runs.
  output: process.env.THREADBOARD_STANDALONE ? "standalone" : undefined,
  // The SDK finds its native Claude Code binary with a runtime require.resolve that tracing can't
  // see, so pull in the platform package explicitly.
  outputFileTracingIncludes: {
    "/**/*": [
      "./node_modules/@anthropic-ai/claude-agent-sdk/**/*",
      `./node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/**/*`,
    ],
  },
  // lib/login.ts runs a CLI by a runtime path, which makes tracing pull in the whole project
  // folder; keep electron-builder's output (dist/) out of it. These globs match anywhere in a path,
  // so a bare "dist/**" would also drop .next-dist/server/chunks. scripts/prepare-standalone.mjs
  // prunes the source files that come along.
  outputFileTracingExcludes: {
    "/**/*": ["./dist/mac*/**/*", "./dist/Weft-*", "./dist/builder-*"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  // The Agent SDK spawns the CLI from files inside its own package, so it must not be bundled.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  // The "N" dev badge sits over the board's bottom-left corner; compile and runtime errors still show.
  devIndicators: false,
  // The desktop shell loads the app from 127.0.0.1, not localhost.
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Server Fast Refresh sometimes sends a launch into a loop: each request for the board applies a server update
    // that counts as a change, which makes the board refetch, a couple of times a second, so it never gets past
    // its placeholder cards (vercel/next.js#94915). Off, a server file change reloads that route's server modules
    // on the next request instead; runner state lives on globalThis, so threads and sessions survive it.
    turbopackServerFastRefresh: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
