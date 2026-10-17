# Callouts

Users type Obsidian callouts (`> [!note]`, `> [!columns]`, `> [!infobox]`, `> [!images|grid]`). Willemstad restyles the standard set (IBM Carbon-like borders unless `ssopt-callout-standard`) and adds layout types.

## Sub-features

- Standard types painted when `body` is **not** `.ssopt-callout-standard`: `note`, `aside`, `warning`, `success`, `important`, `code`, `goal`, `link`, …
- `success` and `important` have extra title/animation rules
- `[!columns]` — `.callout[data-callout="columns"] > .callout-content` is a horizontal flex of nested callouts; width metadata `w1`–`w5` / `width-1`–`width-5`
- `[!infobox]` — floats right, width `var(--infobox-set-width)` (default 50%); metadata `fl` / `fr` flips the float
- `[!images|grid]` and `[!images|gallery]` — `data-callout="images"` plus metadata containing `grid` or `gallery`
- Metadata: `no-title` / `no-t`, `opp` / `opposite`, `monospace`

## How to get to it (user POV)

In any note (reading or live preview):

```markdown
> [!note]
> Body

> [!columns]
> > [!note] Left
> > > [!tip] Right

> [!infobox]
> | k | v |

> [!images|grid]
> ![](a.png) ![](b.png)
```

Docs: https://willemstad.cc/Features/Callouts/Callouts

## Driving it with preview-chrome

```bash
.cursor/skills/verify-willemstad/helpers/drive.sh callouts
```

Fixture: `/preview/callouts.html`. Asserts note callout exists, columns content is `flex` with ≥2 children, infobox `float: right`, image-grid content `display: grid`.

Optional user path: `?opt=ssopt-callout-standard` to see core Obsidian-like callout chrome. That path is **not** the default proof.

## Gotchas

- Columns and images titles are styled; the **content** row is the layout. Do not assert `display:flex` on the outer `.callout`.
- Gallery and grid share `data-callout="images"`; distinguish with `data-callout-metadata`.
- ITS Theme callout snippets conflict — bug reports already warn to disable them. Do not load extra snippets in the harness.
- Nested callouts inside columns must be **direct** children of `.callout-content`.
