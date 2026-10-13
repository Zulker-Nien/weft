# Themes and scenes

Settings → Appearance (or ⌘K "Theme: …") picks how the board looks: **System**, **Light**, **Dark**, or a **scene**:
one of Weft's own pictures behind the board, with a palette drawn from it and clear columns (a faint edge, no frost) so the picture shows between the cards.

| Scene | Picture (`electron/assets/`) | Builds on |
| --- | --- | --- |
| Twin Suns | `splash-speeder.jpg` | dark |
| Canyon | `backdrop-canyon.jpg` | dark |
| Coast Road | `backdrop-coast-road.jpg` | dark |
| Neon City | `backdrop-neon-city.jpg` | dark |
| Snow Pass | `backdrop-snow-pass.jpg` | dark |
| Salt Flats | `backdrop-salt-flats.jpg` | light |

## Key files

- `lib/theme.ts`: `SCENES` (id, label, picture, base palette) is the one list; `Theme` is `"system" | "light" | "dark" | SceneId`.
  `savedTheme()` reads the `weft-theme` cookie, `setTheme()` writes it and applies it, `applyTheme()` sets
  `<html data-theme>` (the base, light or dark) and `<html data-scene>` (the scene, if any).
  `THEME_SCRIPT` is the same logic inlined into `<head>` so the first paint is right.
- The weft.zip home page's third-party tracking (Google Analytics, mounted only on the marketing page)
  lives in `docs/architecture/analytics.md`.
- `app/globals.css`: the light palette on `:root` and the dark one on `:root[data-theme="dark"]`; each scene is a
  `:root[data-scene="<id>"]` block that overrides the colors and sets `--scene` (its picture) and `--scrim`
  (a gradient that keeps text readable). `:root[data-scene] body` paints scrim, picture, then canvas;
  `:root[data-scene] [data-column].bg-sunken` makes the columns clear with a faint `--line-strong` edge, so the picture shows between the cards; a drag still lights a column with `bg-accent-soft`.
- `app/api/scenes/[id]/route.ts`: serves a scene's JPEG from `electron/assets/`. Only ids in `SCENES` resolve, so the
  id can't name another file; localhost-only like every route (`lib/guard.ts`); cached for a day.
- `components/AppearancePicker.tsx`: the Settings control: three buttons, then a picture tile per scene.
  `components/board-palette.ts` adds a "Theme: …" command per theme and scene.
- `electron/theme-source.cjs`: what `nativeTheme.themeSource` should be for the cookie's value (a scene follows its
  base; unknown values follow the system). `electron/main.cjs` `setThemeSource()` uses it, so window chrome, native
  menus and the splash match the scene. Its test checks the table against `SCENES`.

## Data flow

Pick → `setTheme(id)` writes the `weft-theme` cookie (cookies survive the app's server landing on a different port,
localStorage doesn't) → `applyTheme()` sets the two `<html>` attributes → CSS swaps the palette and the picture loads
from `/api/scenes/<id>` → Electron main watches the cookie (`followThemeChoice()`, docs/architecture/desktop-shell.md)
and sets `nativeTheme.themeSource`.

## Adding a scene

1. Put the JPEG in `electron/assets/`.
2. Add a row to `SCENES` in `lib/theme.ts` and to `BASES` in `electron/theme-source.cjs`.
3. Add a `:root[data-scene="<id>"]` block in `app/globals.css`, copying a scene with the same base.

`electron/theme-source.test.ts` fails when `BASES` drifts from `SCENES`; `lib/theme.test.ts` checks each scene has a unique id and a jpg.

## Patterns

- Colors come only from CSS variables, so a scene needs no component changes; any new surface should use `--panel`,
  `--card` or `--sunken`, never a hard-coded color.
- The picture is a CSS background on `body`, behind everything; columns are clear over it (no `backdrop-filter`).
