# 022: a shared page's pane showed its HTML as source text

**Date:** 2026-10-17 · **Severity:** Medium (the viewer's right half was unreadable for any `~/.weft/show` page)

## Symptom

On `weft.zip/s/<id>` the pane showed `<!doctype html><html lang="en">…` as plain text, with `→` and `−` shown as `â†’` and `âˆ'`.

## Cause

The page is uploaded as `text/html; charset=utf-8` (checked in `storage.objects.metadata`), but Supabase Storage serves HTML back as `text/plain` on purpose, so a bucket can't host a live page. `/api/s/[id]/page/[sha]` took the downloaded blob's type as the answer, so the iframe got `text/plain` with no charset: source text, and UTF-8 read as Latin-1.

## Fix

The route decides the type from the file (`lib/share-page.ts` `pageContentType`): a `text/plain`, untyped or octet-stream body that starts like HTML (`<!doctype html` or `<html`, after a BOM or whitespace) is served as `text/html; charset=utf-8`; every other text type declares `charset=utf-8`, which is what the route decodes and re-encodes it with (it masks key-shaped text first). Non-text bodies pass through as bytes. The CSP sandbox is unchanged; it, not the type, is what makes serving someone's HTML safe.

**Key rule:** never trust the Content-Type a Supabase Storage download reports for HTML; read it from the bytes or from `storage.objects.metadata`.

**Files:** `lib/share-page.ts` (+ test), `app/api/s/[id]/page/[sha]/route.ts` (+ test).
