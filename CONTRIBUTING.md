# Contributing to Willemstad-X (fork)

This repository is a community fork of [tingmelvin/willemstad-x](https://github.com/tingmelvin/willemstad-x).
Upstream is no longer maintained; this fork carries the theme forward.

Everything below describes **this fork's** workflow. The theme itself, its features
and its documentation still live at [willemstad.cc](https://willemstad.cc).

---

## The one rule

> **`theme.css` is generated. Never edit it by hand.**

Edit files under `src/`, then run `node scripts/build.mjs`. The build assembles
`src/` into `theme.css` and the CI check (`node scripts/build.mjs --check`)
compares the result against what is committed, byte for byte.

If you hand-edit `theme.css`, the next build silently reverts your change, and CI
fails on the pull request. This is deliberate: it is the only way to keep a
5 MB generated stylesheet honest about what its sources say.

---

## Setup

Requires **Node.js >= 20**.

```bash
pnpm install        # or: npm install
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Assemble `src/` → `theme.css` |
| `pnpm run build:check` | Verify `src/` reproduces the committed `theme.css` exactly |
| `pnpm test` | Run the automated test suite |
| `pnpm run lint:css` | Stylelint over `src/` |
| `pnpm run check:version` | Verify the three version records agree |
| `pnpm run verify` | The gate: audit, build check, version check, lint, tests (what CI runs) |
| `pnpm run verify:all` | Alias for `verify` |

`verify` is the whole gate. It used to exclude `check:version` because the version
metadata was genuinely inconsistent; that defect is fixed
([docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) #1), so the check is back in the gate
where it belongs.

## Where things live

```
src/
  entries/theme.css      build entry — the include manifest; order == cascade order
  meta/                  licence, copyright, print stylesheet, Hub compatibility
  root/                  design tokens: colour variables, typography, radius, motion
  colour/                the decoupled colour engine and its palettes
  app-ui/                window chrome: tabs, side panes, status bar, startup screen
  editor/                editor and reading view
  interactives/          buttons, checkboxes, inputs, dropdowns
  elements/              loose elements, titlebar
  modals/                settings / theme store / plugin store dialogs
  plugins/core/          Obsidian core plugin integrations
  plugins/community/     third-party plugin integrations
  cssclass/              opt-in `cssclasses:` features (LaTeX, Cornell notes, …)
  style-settings/        Style Settings panel definitions (YAML)
  assets/fonts/          embedded woff2 fonts
  assets/icons/          embedded SVG icons
  overrides/             late, cross-cutting fixes that must win the cascade
```

Full data flow and rationale: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Common tasks

### Change a style

1. Find the partial. Section IDs are stable and searchable — the compiled CSS keeps
   a banner comment per section, and the filenames mirror them, so searching
   `src/` for a selector is usually enough.
2. Edit the `.css` file in `src/`.
3. `pnpm build` and check the diff on `theme.css` — it should touch only the lines
   you meant to change.
4. `pnpm run verify`.

### Add a new section

Sections are just files listed in `src/entries/theme.css`. To append one:

```css
/*@include my-module/140-my-thing.css */
```

**Order matters.** CSS is a cascade: a later rule with equal specificity wins. Put
new rules where they need to land, not at the end by reflex.

### Add or change a Style Settings option

Panels live in `src/style-settings/*.yaml` and are inlined into the stylesheet as
`/* @settings … */` comment blocks, which is how the Style Settings plugin reads
them. The YAML file holds the whole comment, fences included.

Two things bite here:

- **Setting `id`s must be globally unique.** A duplicate id makes the plugin's
  panel render unpredictably. `tests/style-settings.test.mjs` enforces this.
- A `class-toggle` setting only does something if the class it emits is actually
  styled. A toggle nothing references is dead UI; the tests flag those too.

### Swap or add an embedded font

Drop the `.woff2` in `src/assets/fonts/` and reference it from a `@font-face`
block with a `@font` directive:

```css
@font-face {
  font-family: "My Font";
  src: /*@font assets/fonts/my-font.woff2 */;
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

The build expands it to a base64 `data:` URI. The theme must stay self-contained —
Obsidian users install a single `theme.css`, so there is nowhere to put a separate
font file.

### Release a new version

```bash
node scripts/bump-version.mjs 1.12.0 --min-app 1.13.0
```

This updates `manifest.json`, adds the entry to `versions.json`, rewrites the
version string baked into `src/meta/`, rebuilds, and re-runs the version check.
Use `--dry-run` first to see what it would touch.

`manifest.json`, `versions.json` and the version printed inside the stylesheet must
agree. `pnpm run check:version` enforces it; CI runs the same script.

---

## Pull requests

Before opening one:

```bash
pnpm run verify
```

That runs the same checks CI gates on. A PR that fails `build:check` is almost
always one of these:

- `theme.css` edited directly instead of `src/`
- `src/` edited but not rebuilt (`pnpm build`)
- line endings changed (the build emits **CRLF**; `.gitattributes` pins it)

If `build:check` reports drift, the message names the first differing line and
shows both versions — that is usually enough to see what happened.

### Commit messages

Conventional-commit prefixes keep the history readable:
`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.

If a change is visible to users (anything that alters rendering), say which
Obsidian version you checked it on.

---

## Reporting bugs

Include:

- Obsidian version and platform
- Which theme version (it is printed in the titlebar and in Settings → Appearance)
- The Style Settings options that were active — most visual behaviour in this
  theme is option-dependent, and "it looks wrong" is usually "option X plus
  version Y"
- A screenshot, or the snippet of markdown / CSS class that reproduces it

---

## Licence

GPL-3.0, unchanged from upstream. Attribution for third-party code and assets is
preserved in `src/meta/` and in the README. By contributing you agree your work is
licensed under the same terms.
