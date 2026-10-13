# 014: sign-in failure dialog showed raw HTML entities

- **Date:** 2026-10-13
- **Severity:** Low (cosmetic — the failure message was readable but ugly, with `&#NN;` and
  `&amp;` appearing literally in the native dialog text)

## Symptom

When a sign-in failed and the server returned a rendered error page, the Electron sign-in
handler showed the page's detail in a native `dialog.showMessageBox` call. The text came
through with HTML entities still escaped: a page whose `<p>` read "Couldn't exchange
external code: a49a" appeared in the dialog as `Couldn&#39;t exchange external code: a49a`,
and any literal `&` or `<` in the page text showed up as `&amp;` / `&lt;`. The browser path
was unaffected (the page itself rendered correctly there), so the bug was only visible in
the Electron-native failure dialog.

## Root cause

`extractErrorMessage()` in `electron/account-link.cjs` read the response body, regexed out
the `<h1>` and `<p>`, stripped any inner tags with `<[^>]+>`, and returned the trimmed
result. That pipeline removed markup but did **not** decode the HTML entities the page
producer escaped in the first place. The page is built by `accountPage()` in
`lib/account-page.ts`, which escapes user-controlled text (error descriptions, error codes)
into the `<h1>` and `<p>` before serializing. The browser renders the resulting HTML
normally; the native dialog, which receives a plain string, does not — so anything
escaped arrived at the user as the escape itself.

## Fix

A new `decodeEntities()` helper in `electron/account-link.cjs` decodes the three entity
forms the page producer emits:

- `&#NN;` (numeric decimal) → `String.fromCodePoint(Number(n))`
- `&#xNN;` (numeric hex) → `String.fromCodePoint(parseInt(n, 16))`
- `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` (named) → a small lookup table

`extractErrorMessage()` now calls `decodeEntities()` on the stripped text before the
`trim()`, so the regex pipeline is "match tag → strip inner tags → decode entities →
trim". The page preference also changed: the detail is the page's `<p>`, falling back to
the `<h1>`, then a stock `Sign-in failed` line — the dialog title is already
"Couldn't sign in to Weft", so showing the heading again in the body was redundant.

Tests in `electron/account-link.test.ts` cover both: a page whose `<p>` contains
`&` and `<` (decoded to the literal characters), and a page that has only an `<h1>`
with `&#39;` in it (decoded to `'`), plus the `Sign-in failed` fallback.

## Key rule

Any time HTML produced for display inside the app is then **re-flattened** for a non-HTML
surface (native dialog, system notification, log line, clipboard), the text must be
decoded as well as tag-stripped. The `accountPage()` producer escapes intentionally
because the page is served as `text/html`; the consumer that pulls a substring out of
that HTML and shows it in a plain-text surface is responsible for undoing the escape.
Tag-stripping alone is not enough.

## Files involved

- `electron/account-link.cjs` — new `decodeEntities()` helper; `extractErrorMessage()`
  calls it and prefers the `<p>` over the `<h1>`.
- `electron/account-link.test.ts` — two new `extractErrorMessage` cases (decoded special
  characters in the `<p>`, fallback to the `<h1>` and then `Sign-in failed`).
- `lib/account-page.ts` — `accountPage()` is the producer that escapes the text in the
  first place; the dialog-side fix exists because of how it serializes.
