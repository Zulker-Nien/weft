---
name: preview
description: Start the project's dev server, confirm it is up and the app really renders, and report the url and start command for the review tour. Use before handing work to review, or when the user says "preview", "start the dev server", or "is it running".
---

Make sure the app you built is running and works, so the user can review it in Weft's browser pane.

## Steps

1. Find the start command: the `dev` script in `package.json` (or `start`, `make dev`, the README). Note the port it prints or configures.
2. See whether it already answers: `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/`. Any HTTP status means a server is there; a connection error means it is not.
3. If it is not running, start it with `mcp__devservers__start` from the project folder, passing the `command` and the `url` you found. Weft keeps it running after this thread's CLI closes, lists it in the Services drawer, and the user can stop it there. The tool polls the url for up to 60s. If it never answers, read the server's log, fix the cause (missing install, busy port, build error), and start it again. Do not hand work to review with a dead server. Fall back to Bash `run_in_background` only when `mcp__devservers__start` is not available.
4. Check it really renders, not just answers: open the url with `mcp__browser__open_url`, then `mcp__browser__read_page` and `mcp__browser__screenshot`. A blank page, an error overlay, or a 500 means it is broken. Fix it and check again.
5. Visit the page for each feature you are about to put in the review tour and confirm it loads.
6. Report the result in one line: the url, whether it rendered, and the exact start command.

## In the review tour

Put what you found in the `weft-review` block: `"url"` is the address that answered and `"dev"` is the start command from step 1 (run from the project folder). Weft uses `dev` to start the server for the user, show whether it is running, and restart it from the tour.

If the work is not a web app, skip this skill and leave `url` and `dev` out.
