# 024: A shared mini app's public link said "Not found" once its Mac shared a folder

**Date:** 2026-10-19 · **Severity:** Medium (a public link that worked went dark; the page was still in storage)

## Symptom

`weft.zip/a/<id>` for 📈 Growth, shared public, showed its header and then "Not found" in the frame.

## Cause

The Mac and weft.zip run different code. The Mac (uncommitted work for hosted folder apps) wrote Growth's `cloud_app_shares` row as `kind: folder`, `page: index.html`, with a `files` map of path to sha. The deployed viewer frames `/api/a/<id>/page` for every row that isn't a site, and that route called `appBlobSha(row)`, which returns a sha only for `kind: blob`. A folder row gave `null`, so the route answered 404 even though `weft-blobs/<org>/<sha>` held the file.

## Fix

The route falls back to the folder's entry file, `files[page]`, checked as a 64-hex sha, and serves it through the same gate, `serveBlobPage` and sandbox.

Before:

```ts
const sha = appBlobSha(access.share);
```

After:

```ts
const sha = appBlobSha(access.share) ?? folderEntrySha(access.share);
```

**Key rule:** a row kind the Mac can write must be readable by the code that is deployed. Ship the server side of a new share shape before a Mac writes it.

**Files:** `app/api/a/[id]/page/route.ts`, `app/api/a/[id]/page/routes.test.ts`, `docs/architecture/mini-apps.md`.
