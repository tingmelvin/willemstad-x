# Reading chrome

The first thing a user sees after selecting Willemstad: workspace chrome, the version string in the titlebar, and coloured headings on a markdown note. Light and dark are first-class.

## Sub-features

- Titlebar version stamp from `theme.css` `AA01-1-1`: `div.titlebar-text::after` → `  /  Willemstad v1.11.1 Newfoundland`
- Coloured H1–H6 inside `.workspace-leaf-content[data-type="markdown"]` unless `body.ssopt-no-coloured-headers`
- `body.theme-dark` vs `body.theme-light` (defaults are near-achromatic; accent still paints headers)
- Body copy, wikilink, inline code, blockquote, fenced code

## How to get to it (user POV)

1. Install Willemstad (`theme.css` + `manifest.json` in `.obsidian/themes/Willemstad/`).
2. Settings → Appearance → Themes → Willemstad.
3. Open any note in reading view. Toggle Settings → Appearance → Base color scheme for light/dark.
4. Confirm the window titlebar (or community theme row) shows the Willemstad version.

In the harness: `/preview/reading.html?mode=dark` and `?mode=light`.

## Driving it with preview-chrome

```bash
.cursor/skills/verify-willemstad/helpers/drive.sh reading
```

Opens both modes. Asserts:

- `titleAfter` contains `Willemstad v`
- `h1` `background-color` is not transparent in either mode
- `body` background differs between dark and light
- `body` has `theme-dark` / `theme-light` respectively

Manual: `GET $BASE_URL/preview/reading.html?mode=light` in Chrome and compare H1 paint to the dark shot.

## Gotchas

- Header colour rules require the heading to sit under `.workspace-leaf-content[data-type="markdown"]`. A bare `<h1>` on `<body>` will not get `--col-h1-bg`.
- `body.ssopt-no-coloured-headers` turns the feature off; do not use that class when proving the default.
- `.ssopt-tb-willemstad` removes the titlebar version (`AA01` option). Default preview must omit it.
- `minAppVersion` in `manifest.json` is `1.13.0`. The preview cannot prove installer/app version; doctor only checks the CSS banner vs `manifest.json`.
