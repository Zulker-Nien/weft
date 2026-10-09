# Security

Weft runs AI coding agents on your machine, often with tool permissions turned up (new threads
default to `bypassPermissions`). Treat it like a terminal.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private reporting:
**Security → Report a vulnerability** on https://github.com/aimhuge/weft/security/advisories/new.

Include what you found, steps to reproduce, and the impact. We aim to reply within a few days.

## What's in scope

- The local server: every `app/api/*` route should only answer requests addressed to
  127.0.0.1/localhost, and writes need the `x-threadboard` header (`lib/guard.ts`). A way for a
  website or another local user to drive the board is a vulnerability.
- The browser-pane control server in `electron/browser-pane.cjs` (token-guarded, 127.0.0.1).
- The `weft://` link handler.
- Anything that leaks files in `~/.weft` or your CLI credentials.

Agents running with permissions you granted them, doing what you asked, are not a vulnerability.
