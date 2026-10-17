# Willemstad feature map

Primary surface: Obsidian reading / live-preview chrome painted by `theme.css`.
Harness: isolated preview at `/preview/*.html` driven by `helpers/drive.sh`.

| Feature | Preview | Drive |
| --- | --- | --- |
| [Reading chrome](reading.md) | `/preview/reading.html` | `helpers/drive.sh reading` |
| [Callouts](callouts.md) | `/preview/callouts.html` | `helpers/drive.sh callouts` |
| [CSSClasses](cssclasses.md) | `/preview/cssclasses.html` | `helpers/drive.sh cssclasses` |
| [Alternative checkboxes](alternative-checkboxes.md) | `/preview/checkboxes.html` | `helpers/drive.sh checkboxes` |
| [Focused mode](focused-mode.md) | `/preview/focused-mode.html` | `helpers/drive.sh focused-mode` |

Docs users actually read: [willemstad.cc](https://willemstad.cc). Style Settings plugin is required for `ssopt-*` toggles in the real app; the harness applies those classes via `?opt=`.

Not mapped yet (add via `/maintain-verification-skill` when you next touch them): block widths (`ssopt-block-width-*`), colour palettes / RealDisplay, `writing` / Longform, Publish (`publish.css`).
