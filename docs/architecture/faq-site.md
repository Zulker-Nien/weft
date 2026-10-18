# The FAQ on weft.zip

`docs/FAQ.md` is written for GitHub and is also the site's FAQ: the home page ends with six of its
questions, and `weft.zip/faq` renders the whole file. One source, so the repo and the site never drift.

## Key files

- `docs/FAQ.md`: the content. Plain Markdown, with a few raw-HTML image rows (`<p>` around `<img>` tags,
  for side-by-side pictures) and paths relative to `docs/`.
- `public/brand/faq/`: its pictures. They live under `public/` so the site serves them at `/brand/faq/…`
  and GitHub still resolves them through `../public/brand/faq/…`.
- `lib/faq.ts` (+ `lib/faq.test.ts`): the pure logic and `FAQ_HIGHLIGHTS`, the home page's six questions.
- `components/home/FaqDoc.tsx`: draws the file. `components/home/FaqTeaser.tsx`: the home page's rows.
  `components/home/HomeChrome.tsx`: the nav and footer the home page and `/faq` share (both link the FAQ).
  `components/home/faq.css`: plain prefixed CSS, for the reason `home.css` is (`next.config.ts` sends every `.css` through Tailwind).
- `app/faq/page.tsx`: reads `docs/FAQ.md` once at module scope, so the page prerenders at build time.

## Data flow

1. `app/faq/page.tsx` reads the file with `readFileSync`. `next.config.ts` lists it under
   `outputFileTracingIncludes["/faq"]`, so the standalone server and Vercel ship it too.
2. `splitFaq()` cuts the raw-HTML image rows out and returns an ordered list of Markdown and image
   segments, so react-markdown never sees raw HTML (it would drop or escape it).
3. `FaqDoc` renders each Markdown segment with react-markdown + remark-gfm and each image row as a flex row
   (`.wz-faqRow`) or a single picture (`.wz-faqSolo`).
4. Three small mappings make a GitHub-shaped file work on the site:
   - `webSrc()`: `../public/x` becomes `/x`.
   - `webHref()`: a path relative to `docs/` (`../README.md`, `architecture/secrets.md`) opens on GitHub
     (`REPO/blob/main/…`); anchors and absolute links stay.
   - `headingId()`: GitHub's heading anchor (lowercase, drop punctuation, spaces to hyphens), so the file's own
     contents links (`#the-basics`) and the home page's More links (`/faq#what-is-weft`) land.

## Patterns and rules

- **A highlight is a real heading.** `FAQ_HIGHLIGHTS[].question` must equal a `###` heading in `docs/FAQ.md`, or its
  More link lands nowhere. `lib/faq.test.ts` checks this, plus that every contents link has a heading and every
  image path exists. Rename a question in the file and that test says which highlight to update.
- Picture rows must stay `<p>` blocks of `<img>` tags (or a lone `<img>` line): `splitFaq()` only understands those.
- Adding a question needs no code: write it under its `##` section in `docs/FAQ.md`.
