# Alternative checkboxes

Style Settings toggle **Alternative Checkboxes Reference Set** adds `body.ssopt-acrs-enable`. Task characters beyond `[ ]` / `[x]` get Lucide mask icons on `li[data-task]` / `.HyperMD-task-line[data-task]`.

## Sub-features

Characters implemented in `theme.css` (ACRS block): `/` `-` `>` `<` `?` `!` `*` `"` `l` `b` `i` `S` `I` `p` `c` `f` `k` `w` `u` `d`. Regular space and `x`/`X` stay theme-default.

Without `ssopt-acrs-enable`, `--theme-alternative-checkboxes: disable` and those masks do not apply.

## How to get to it (user POV)

1. Install Style Settings. Settings → Style Settings → Willemstad → enable Alternative Checkboxes (command-capable toggle `ssopt-acrs-enable`).
2. In a note: `- [?] what` / `- [!] warn` / `- [/] incomplete`.
3. Reading view or live preview: the checkbox glyph changes.

Docs: https://willemstad.cc/Features/Alternative+Checkboxes+Reference+Set

## Driving it with preview-chrome

```bash
.cursor/skills/verify-willemstad/helpers/drive.sh checkboxes
```

Visits `/preview/checkboxes.html` (off) and `?opt=ssopt-acrs-enable` (on). Asserts `li[data-task="?"]` `--icon-mask-image` is set only when ACRS is on, and the two reports differ.

## Gotchas

- The mask is a custom property on the **`li`**, painted onto `input[type=checkbox]:checked::after`. Probing the input's `content` is weaker than reading `--icon-mask-image` on the `li`.
- Unchecked `[ ]` and done `[x]` are intentionally left to default styling.
- Other community checkbox snippets will fight this. Harness loads only `theme.css`.
