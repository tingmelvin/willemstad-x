# Focused mode

Immersive editing. Style Settings (or a command the theme registers) adds `body.ssopt-focused-mode` or `body.ssopt-super-focused-mode`. Chrome hides; distant CM6 lines fade.

## Sub-features

- `ssopt-focused-mode` **and** `ssopt-super-focused-mode` set `display: none` on `.mod-sidedock`, `.side-dock-ribbon`, `.workspace-leaf-content .view-header`, `.titlebar`, `.status-bar`, and live-preview properties
- Active markdown leaf: `.cm-line.cm-active` opacity 1; neighbours fade via `--distant-opacity` (0.2) and `--near-fade-factor`
- Super focused also hides `.workspace-tabs:not(.mod-active)` and `.workspace-tab-header-container`

## How to get to it (user POV)

Settings → Style Settings → Willemstad → Focused Mode / Super Focused Mode (or the matching command). Open a markdown tab and type: only the current line stays fully opaque and the docks disappear.

## Driving it with preview-chrome

```bash
.cursor/skills/verify-willemstad/helpers/drive.sh focused-mode
```

`/preview/focused-mode.html` then `?opt=ssopt-focused-mode`. Asserts docks/titlebar/status/ribbon are visible first and `display: none` after.

Manual extra: `?opt=ssopt-super-focused-mode` should also hide `.workspace-tab-header-container`. That variant is mapped but not in the default assert list — add a shot if you change super-focused rules.

## Gotchas

- Hiding is `display: none` on those exact classes. A harness that omits `.titlebar` / `.mod-sidedock` cannot prove the feature.
- Line fading only applies under `.mod-active > .workspace-leaf-content[data-type="markdown"]` to `.cm-line` / `.cm-gutterElement`. Reading-view paragraphs will not fade.
- macOS frameless padding exceptions exist (`body.mod-macos`). The preview is not `mod-macos`; do not claim traffic-light behaviour from this harness.
