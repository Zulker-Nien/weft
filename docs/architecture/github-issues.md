# GitHub issues

Status: issues → cards built 2026-10-12 (phase 2 below). One direction only: Weft reads issues and never edits
one. Card → issue, two-way sync, Projects v2 columns and comments are later phases.

Turn it on for a project from ⌘K: **Import GitHub issues into <project>** (the open thread's project, or your
most recent one). That opts the folder in and syncs it right away; the toast reports how many cards were added,
updated and archived.

## How it works

`lib/github-issues.ts` reads issues through the `gh` CLI (`execFile`, no shell), so it uses your existing
`gh auth login` and needs no token of its own. The repo is the folder's (`gh repo view`).

For each opted-in folder, each open issue becomes a Backlog card:

- **Title**: the issue's title (`titleBy: "user"`, so retitle leaves it).
- **Prompt**: the issue's body, a link to the issue, and "When you commit the fix, add `Fixes owner/name#N` to the
  commit message", so the commit closes the issue (`issuePrompt`).
- **Tags**: the issue's labels, normalized by `lib/tags.ts` (`tagsBy: "user"`). Each label goes into the tag catalog
  with its GitHub colour and description (docs/architecture/tags.md).
- **`card.issue`**: `{repo, number, url, state, updatedAt}`. The card shows "#N", linked to the issue.

## Rules

- **A started card is never touched.** Once a card has left Backlog, has a session or has run a turn, it's yours.
- **Closed issues archive their card** only if it never started.
- **An edited issue updates its card**: new labels replace the tags only when the issue changed since Weft last read
  it, so tags you edited on the card stay until the issue changes again.
- **A deleted card stays deleted.** Issue numbers already imported are kept in `~/.weft/github-issues.json`, per
  repo, and never imported again.
- One sync per folder at a time; a second call while one runs gets the same result.

## Pieces

- `lib/github-issues.ts`: `fetchIssues` (open issues, up to 500, plus the 100 most recently updated closed ones),
  `syncIssues`, `syncAllIssues`, `startIssueSync`, and each folder's last result or error (`issueSyncStatus`).
- `lib/settings.ts`: `issueFolders`, the opted-in folders.
- `app/api/github/issues`: GET is each folder's sync status, POST `{folder}` turns it on and syncs now, DELETE turns
  it off.
- The poll starts in `prewarm()` (`lib/copilot.ts`), off the request path: a first sync 20s after the server
  starts, then every 5 minutes.
- `components/board-palette.ts`: the ⌘K command.
- `components/CardMarks.tsx`: the "#N" link on the card.

## Later phases

1. **Card → issue.** Make an issue from a card (title, prompt, tags as labels), and link the card to it.
2. **Issues → cards.** Built (above).
3. **Two-way sync.** Title, labels and open/closed state kept in step both ways, with the newest edit winning.
4. **Projects v2 status columns.** Map a GitHub Project's Status field to Backlog, Running, Needs you, Review and
   Done, so moving a card moves the item.
5. **Comments.** Post a turn's summary to the issue, never the transcript. Vault values are removed first (the
   `‹NAME›` redaction), and a public repo gets a warning before anything is posted.
