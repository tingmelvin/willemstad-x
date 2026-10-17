# Defect log — fixed and remaining

This fork's history has two milestones, and they pull in opposite directions.

**Milestone 1 — infrastructure.** Split the 4.9 MB single-file stylesheet into 137
editable modules, build it back byte-for-byte, and add the harness that keeps it
honest. The invariant was that `theme.css` stayed **byte-identical to the last
upstream release**. That is why every defect below was, at the time, deliberately
left unfixed and merely *pinned* by a test.

**Milestone 2 — fix the defects.** The maintainer authorised behaviour changes and
ruled that Obsidian **1.13** is the compatibility target. All eight issues were
fixed and the stylesheet rebuilt:

```
upstream   f223ca9debab7e4ac50e37190b67dcd4c331e9014cde6282e45e96f71dfd202b  5,260,865 B
after fix  a66dd63c510291dc2170196e3f64eb10a6e265aef1b51283f924c072b82320c2  5,258,014 B
```

The byte-identical invariant is therefore **retired on purpose**. It did its job:
it made milestone 1 provably lossless. It would now only prevent fixes.

Milestone 2 also had to be **rebased onto upstream's next 13 commits**, which by
then already contained PRs #82–#89: the `verify-willemstad` skill, a `justfile`
with its Python test suite, a CI workflow, and — notably — upstream's own fix for
#1 plus a release-token refactor that introduced #9 below.

---

## Which fixes you should eyeball

Three of the nine alter rendering. Everything else is metadata, dead code, or a
label correction. If you review anything in Obsidian, review these:

| Fix | What to look at |
| --- | --- |
| #4a `--opp-table-border-color` | A table header border, **only with contrast mode on** (`ssopt-theme-contrast-*`) |
| #4b `--opp-pdf-shadow` | A PDF embed, **only with contrast mode on** |
| #4c `--col-bg-table` | An `[!infobox]` callout title — it now has a background where it previously had none |

#9 restores rendering that upstream had already broken: the version text in the
title bar and the community card. Check it appears; before this fix it did not.

Everything else was verified to produce identical output, or to remove something
that already had no effect.

---

# Fixed

## 1. `versions.json` understated the compatibility floor — *release-blocking*

```
manifest.json   version = 1.11.1   minAppVersion = 1.13.0
versions.json   "1.11.1": "1.11.0"   →  "1.13.0"
```

Obsidian reads `versions.json` as a `version → minAppVersion` map to decide which
users it may offer an update to. The mismatch meant users on 1.11.x–1.12.x could be
offered a release the manifest said needed 1.13.0.

**Fixed:** set to `1.13.0`, per the 1.13 ruling. `pnpm run check:version` now exits 0.

## 2. A Style Settings panel was not valid YAML — *latent*

`src/style-settings/07-v1-willemstad-ancillaries.yaml`: the `description` of
`syntax-callouts-columns-metadata` used a multi-line double-quoted scalar whose
continuation lines sat at the **same** indentation as the key. Strict YAML requires
them deeper; `yaml@2` rejected the panel outright. Style Settings uses `js-yaml`,
which is lenient, so the plugin worked and the defect stayed hidden.

**Fixed:** continuation lines indented two spaces deeper. Folding strips the extra
indentation, so **the parsed string is unchanged** — verified byte-for-byte against
the lenient parse. All 12 panels now pass strict parsing.

## 3. Three panels contained a dangling `-` — *latent*

A list-item marker with nothing after it parses to `null`:

- `05-v1-willemstad-ui.yaml` — trailing
- `06-v1-willemstad-editor.yaml` — **doubled marker mid-list**, so the null landed
  between two real settings rather than at the end
- `10-pluglets-iem-settings.yaml` — trailing

**Fixed:** all three removed. `settings` arrays now contain zero null entries.

## 4. Nine undefined custom properties — *five fixed, four reclassified*

Nine `var()` references resolved to nothing, so their declarations were silently
dropped. They were not one bug but three:

**(a) Theme-owned namespaces with a hole — fixed.**

| Property | Now |
| --- | --- |
| `--opp-table-border-color` | `var(--opp-background-modifier-border)` — the sibling line above maps `--table-border-color` to the same token, and Obsidian's own default chain is `--table-header-border-color: var(--table-border-color)` |
| `--opp-pdf-shadow` | `0 0 0 1px var(--opp-background-modifier-border)` — the `--opp-*` set has no shadow members; this matches the block's own convention (`--bases-cards-shadow`, `--metadata-property-box-shadow-*`) |
| `--col-bg-table` | `var(--color-table-head)` — the theme's table-header background token; the stale name and the meaning line up |

**(b) Dead code — deleted.**

| Property | Why |
| --- | --- |
| `--icon-image` | The rule already uses `mask-image: var(--icon-mask-image)`. The second, image-based icon channel was never implemented. |
| `--interactive-bg` | Its only declaration. With it gone the rule was empty, so the rule went too. |

**(c) Externally provided — reclassified, not a typo.** See "Remaining" below.

## 5. A shorthand silently discarded a longhand

`src/modals/092-mc02.css`: `border-color: var(--x)` immediately followed by
`border: 1px solid var(--x)`. The shorthand sets the same colour, so the first
declaration was unreachable.

**Fixed:** both dead `border-color` lines removed. Identical rendering — the
shorthand already won.

## 6. Twenty-seven duplicated declarations

`src/overrides/125-x102.css` carried `font-size: 0;` twice in a row, 27 times.

**Fixed:** the duplicates removed. The `padding` pairs in the same file were
**left alone** — those carry *different* values, so removing one would change
rendering. Only exact consecutive duplicates were collapsed.

## 7. Six Style Settings controls did nothing — *user-visible*

Six `variable-*` settings wrote a custom property the stylesheet never read, so
dragging the control had no effect at all:

`bold-modifier`, `italic-weight`, `nav-item-white-space`, `file-header-justify`,
`tab-stacked-text-transform`, `tab-stacked-text-align`.

The consumer CSS does not exist anywhere — this is not a misspelled variable, it is
a missing implementation. The panel advertised control it could not deliver, which
is the most user-visible defect on this list.

**Fixed by removing the six controls.** The alternative — writing the consumer CSS —
means *inventing rendering* that cannot be reviewed from the repository, and would
change the theme for every user on the strength of a guess. Removing a control that
promises nothing is the only fix verifiable here.

If you want any of these features back, each needs one new rule; the intended
targets are `strong`/`em` font-weight, `.nav-file-title` white-space,
`.view-header-title` text-align, and the stacked-tab title's transform/text-align.
Add the rule, then add the setting back — and look at it in Obsidian.

## 8. Five embedded "woff2" fonts were bare TrueType — *cosmetic*

All 17 embedded fonts were declared `data:font/woff2` with a woff2 `format()` hint,
but five had magic bytes `00 01 00 00` (raw sfnt/TrueType), not `wOF2`:

Manrope, DM Sans ×2, Crimson Pro ×2.

Chromium sniffs the container, so they loaded fine and the lie survived.

**Fixed:** the container is now decided by **magic bytes**, not by the label.
`scripts/extract.mjs` sniffs and names the file accordingly; `scripts/build.mjs`
derives the MIME type from the extension. The five files are now `.ttf`, emit
`data:font/ttf`, and declare `format("truetype-variations")`.

**No font was re-encoded.** Verified: of 69 `data:` URIs, exactly 5 changed their
MIME label and **0 changed their payload bytes**.

## 9. The release token made the version text disappear — *regression*

Upstream introduced one custom property so the rendered version tracks
`manifest.json`:

```css
:root { --willemstad-release: v1.11.1 Newfoundland; }
div.titlebar-text::after { content: "  /  Willemstad " var(--willemstad-release); }
```

The value was **not quoted**. A custom property is substituted as a *token
stream*, so the consumer sees:

```css
content: "  /  Willemstad " v1.11.1 Newfoundland;
```

That is a run of idents and numbers, which does not match `<content-list>`.
The declaration is invalid at computed-value time, so the version text silently
renders as **nothing** — in both the title bar and the community card.

Verified against the CSS grammar (css-tree + `mdn-data`):

| substituted value | verdict |
| --- | --- |
| the pre-token original, `"  /  Willemstad v1.11.1 Newfoundland"` | **valid** |
| unquoted token (as shipped) | **invalid — mismatch** |
| quoted token | **valid** |

**Fixed:** quote the value. Substitution then yields two adjacent strings, which
concatenate to exactly the text the theme printed before the token existed — so
this fixes the regression without changing what any user sees.

A bare token sequence is also why the lint gate flagged it: `value-keyword-case`
read `Newfoundland` as a keyword and errored.

Guarded by `tests/version.test.mjs` (the value must be a quoted string that
tracks the manifest, and both consumers must use the token) and by
`test/test_release_token.py`, which now asserts the quoting rather than just the
prefix.

---

# Remaining

## Four custom properties provided outside the theme — *unverified*

These are referenced but not defined in the stylesheet, and they are **not typos**.
Each is supplied at runtime by something the theme does not control:

| Property | Likely provider | Evidence |
| --- | --- | --- |
| `--pcr-color` | the Pickr colour-picker library | used as `var(--pcr-color, var(--col-highlight-N))` — the fallback is the tell: the author knew it might be absent |
| `--lane-width` | the Kanban community plugin | read on `.kanban-plugin__lane-wrapper` |
| `--layer-modal` | Obsidian's own `--layer-*` z-index scale | the theme defines no `--layer-*` yet uses it for `z-index` |
| `--corner-smoothing` | Obsidian / Electron | feeds the Electron-only `-electron-corner-smoothing` property |

**Not changed**, because there is nothing to change: if these are supplied at
runtime the reference is correct, and if they are not, the right value is
unknowable from here.

**What would settle it:** a copy of Obsidian's `app.css` and the Kanban plugin's
stylesheet. Compare and either move them to the confirmed-built-in list or fix
them. Registered in `tests/fixtures/obsidian-builtins.json` under
`externallyProvided`.

---

# Working with this file

- **A defect that is neither fixed nor pinned will silently rot.** Every entry here
  has a test that fails when the situation changes.
- **Pinning is for live defects.** Milestone 1 pinned all eight; fixing them turned
  those pins red, which is exactly the reminder that was wanted. Now that they are
  fixed, the tests assert the *fixed* state instead.
- **When you add an entry,** add its pin in the same commit. State the exact
  location and the exact count — never `>= 1`, or the pin cannot tell you that
  something changed.
