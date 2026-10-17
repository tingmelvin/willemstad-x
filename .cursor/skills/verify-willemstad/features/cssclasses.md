# CSSClasses

Note-level `cssclass` values in frontmatter restyle the whole document. The two users hit first are LaTeX display and Cornell notes.

## Sub-features

- `cssclass: latex` → `.latex.markdown-preview-view` uses `--cssc-latex-font-reading` at `--cssc-latex-font-size` (14pt), justified text, heading restyle, numbered `.math-block`
- `cssclass: cornell` → `.cornell` shifts `.el-p` / `.el-h*` / tables into a right column; `.callout[data-callout="aside"]` floats **left** into the cue gutter (`--aside-callout-float: left`)
- Related (not in the first drive): `magazine`, banner, `writing` / Longform

## How to get to it (user POV)

```yaml
---
cssclass: latex
---
```

or `cssclass: cornell`. Open the note in reading view. Cornell needs `> [!aside]` (or equivalent) for the cue column.

Docs: https://willemstad.cc/Features/Global+CSSClass/LaTeX+Display+Example and Cornell Notes Example.

## Driving it with preview-chrome

```bash
.cursor/skills/verify-willemstad/helpers/drive.sh cssclasses
```

Fixture: `/preview/cssclasses.html` contains both notes. Asserts latex `font-size` ≥ 14px/14pt and `text-align: justify`, cornell body `justify`, cornell aside `float: left`.

## Gotchas

- Obsidian puts the cssclass on `.markdown-preview-view` **and** the source view. The theme keys `.latex.markdown-preview-view` and `.cornell`. A class on a wrapper that is not those nodes will not match.
- Cornell live preview (`.markdown-source-view.mod-cm6.cornell`) **unsets** the aside float — prove Cornell in reading markup (`.el-p`, `.el-h1`), not CM6.
- `body.ssopt-cssc-latex-preserve-bg-colour` and latex counter options (`ssopt-cssc-latex-counter-*`) change print/math numbering; default drive does not toggle them.
