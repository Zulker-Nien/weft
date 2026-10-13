# Analytics

The deployed Weft at weft.zip ships Google Analytics 4 on the marketing home page only. The board
route, every other route, and every local Weft never call home.

## How it's gated

GA is mounted in `components/home/Home.tsx` (the only importer of `components/GoogleAnalytics.tsx`),
not in `app/layout.tsx`. Two consequences:

- The board route never renders `Home` — `app/page.tsx` returns `<Board />` when `isDeployed()` is
  false (`lib/home.ts`), and on Vercel the snippet is the only client-side script the home adds.
- `app/home/page.tsx` and `app/page.tsx` both load the home through `loadHome()` (`lib/home.ts`),
  so a parse error in `Home.tsx` (or in the `GoogleAnalytics` import chain) returns a small
  fallback page instead of 500-ing the route. See `docs/bug-fixes/011-home-parse-error-took-board-down.md`
  for why that loader exists; the analytics change inherits the same blast-radius guard.

## The snippet

`components/GoogleAnalytics.tsx` is a server component that emits the standard gtag.js loader
(`https://www.googletagmanager.com/gtag/js?id=…`) plus an inline `gtag('config', …)` call with
the measurement id `G-L9YCWJ4LZ2`. The id is hardcoded; the loader URL is `encodeURIComponent`-ed
and the JS literal goes through `JSON.stringify`, so the id can be swapped to any value shaped
like `G-XXXXXXX` without a code change elsewhere. Rendering server-side puts the script in the
HTML before paint; gtag fires a single `page_view` on load.

## Key files

- `components/GoogleAnalytics.tsx` — the snippet, hardcoded `G-L9YCWJ4LZ2`.
- `components/home/Home.tsx` — renders `<GoogleAnalytics />` as a sibling of the page root.
- `app/home/page.tsx`, `app/page.tsx` — load `Home` through `loadHome()`; render a dark
  fallback page when the import fails.
- `lib/home.ts` — `isDeployed()` (VERCEL or WEFT_HOME) and `loadHome()`.
