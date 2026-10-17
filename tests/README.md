# tests/

Automated tests for the Willemstad-X fork. Zero test framework — everything runs
on Node's built-in `node:test`, so `pnpm install` only needs the four dev
dependencies the lint and parse tests require.

```bash
pnpm test                                   # everything (93 tests, ~8 s)
node --test "tests/**/*.test.mjs"           # same thing, explicit glob
node --test tests/build.test.mjs            # one file
node --test --test-name-pattern="budget" "tests/**/*.test.mjs"
```

> **Do not write `node --test tests/`.** On Node 22+ a directory argument is
> resolved as a CJS module to `require()`, so it fails with
> `Cannot find module '…/tests'`. Use the glob (quoted, so the shell does not
> expand it) or pass no argument at all — with no argument Node discovers
> `*.test.mjs` on its own. `package.json`'s `test` script uses the glob form.

---

## The one thing these tests exist to protect

This fork's first milestone changed **no rendered output**: `theme.css` was
byte-identical to the last upstream release. That invariant was **retired on
purpose** when the eight known defects were fixed — it had already proved the
`src/` split lossless, and keeping it would only have blocked the fixes. The fork
now pins its own rebuilt baseline:

```
sha256  0384718b4397846158efa2db0621cf274f4551f21e24306fca629ab755a6d2a4
bytes   5,257,337
```

Everything else — the `src/` split, the build, the tests — is scaffolding around
that artifact. If a test ever needs to change that hash, the change is a *visual*
change and needs a human looking at Obsidian, not a test being updated.

`build.test.mjs` enforces the hash. That is the single most important assertion in
this directory.

---

## What each file guards

| file | tests | guards against |
|---|---|---|
| `build.test.mjs` | 7 | artifact ≠ source; artifact ≠ pinned baseline |
| `structure.test.mjs` | 6 | a partial that is not valid CSS on its own; orphan/duplicate includes |
| `syntax.test.mjs` | 10 | invalid CSS; `@import`; BOM; mixed line endings; leaked build directives |
| `style-settings.test.mjs` | 14 | broken panel YAML; duplicate setting ids; unknown types; dead toggles |
| `variables.test.mjs` | 9 | a `var(--x)` typo whose declaration silently vanishes |
| `assets.test.mjs` | 10 | corrupt base64; wrong font magic; icon/font out of sync with `src/assets/` |
| `manifest.test.mjs` | 12 | release metadata drift; lost licence banner |
| `version.test.mjs` | 11 | the three version records disagreeing |
| `budget.test.mjs` | 7 | the file growing back |
| `stylelint.test.mjs` | 7 | a lint config that silently stops catching things |

93 tests, ~8 s wall clock.

### `build.test.mjs` — the artifact matches its source

Runs `node scripts/build.mjs --check` and asserts the assembled `theme.css`
equals what is committed, plus the pinned hash above. Also runs `--audit` and
pins `publish.css` (the frozen v0.5.4 track) by hash.

**Fails when:** someone edits `theme.css` directly, or edits `src/` without
rebuilding, or the build pipeline itself changes its output.

**How to fix:** `pnpm build`, then review `git diff theme.css`. If the diff is not
what you intended, your `src/` edit was not the one you thought.

### `structure.test.mjs` — the split is honest

Every partial under `src/` must parse standalone, its comments must balance, and
every partial must appear in the entry manifest exactly once. Also asserts the
two *manifest* files are manifests: `src/entries/theme.css` may contain only
`@charset` and comments, and `src/style-settings/126-style-settings.css` may
contain only `@raw` panel directives — neither may carry rules of its own.

**Fails when:** a partial is added but never `@include`d (its CSS silently never
ships), a partial begins/ends mid-comment (unparseable in isolation, and a trap
for editors and linters), or a panel YAML on disk is not inlined anywhere (that
panel would never reach the user).

**How to fix:** `pnpm run build:audit` names the offending files directly.

### `syntax.test.mjs` — the output is valid CSS

Parses `theme.css` with PostCSS, checks brace balance, comment balance, no
`@import` (Obsidian does not support it), no BOM, exactly one `@charset` as the
first node, consistent CRLF, and that no `/*@include … */` directive survived the
build (a leaked directive means a chunk of CSS is silently missing).

**Fails when:** a malformed rule slips through, or line endings change (`.gitattributes`
pins CRLF; a clone with the wrong setting can still break it).

### `style-settings.test.mjs` — the settings panels are well-formed

Extracts all 12 `/* @settings … */` YAML panels, asserts each parses, panel ids are
unique, every setting has a valid Style Settings `type`, every setting id is
globally unique, every `class-toggle` id is actually referenced by the stylesheet,
every `variable-*` id maps to a `--property` the stylesheet reads, and the YAML
sources in `src/style-settings/` match the copy embedded in `theme.css`.

**Fails when:** a duplicate setting id is introduced (the plugin keys state by id,
so two controls would move together), a toggle is added without the CSS behind it,
or a control is added whose `--variable` nothing reads.

**Also asserts three formerly-pinned defects are fixed** — `docs/KNOWN-ISSUES.md`
#2, #3 and #7. Those tests used to assert the defects *still existed* at fixed
locations and fixed counts; now they assert the fixed state, so a regression goes
red instead of a fix going red. The fix record lives in `docs/KNOWN-ISSUES.md`.

### `variables.test.mjs` — no silently-dropped declarations

Collects every `var(--x)` reference and every `--x:` definition. A reference with
no definition resolves to nothing, so its declaration is dropped. The test requires
each such variable to be registered in `fixtures/obsidian-builtins.json` with a
category and a reason.

This is the highest-value test in the set: it catches typos like `--interative-accent`
that are otherwise invisible — the theme just quietly renders wrong.

**Fails when:** you reference a new undefined variable. Register it in the fixture
with a reason, or fix the typo.

The allowlist is organised by *why* a variable can be legitimately undefined:

| category | count | meaning |
|---|---|---|
| `patterns[].regex` | 176 + 48 | generated fallback-chain intermediates (`-tmp` / `-pax`); the chain defines only the innermost value |
| `styleSettingsInjected` | 30 | created at runtime by the Style Settings plugin from a panel entry |
| `obsidianBuiltin` | 81 | provided by Obsidian itself |
| `externallyProvided` | 4 | supplied at runtime by a library, plugin or the host — each entry carries a `provider` field |

The two `patterns` entries carry a `count` as well as a `regex`: the regex proves
the *category* still exists, the count makes any change in its size visible in
review. Three further tests keep the allowlist from rotting — no entry that is no
longer referenced, no entry that is now actually defined, and no `var(--x: …)`
definition typo.

**Diagnostics (not failures):** four variables are provided outside the theme —
by Pickr, the Kanban community plugin, Obsidian and Electron. They are reported on
every run so they stay visible without blocking CI. See
`docs/KNOWN-ISSUES.md` #4.

### `assets.test.mjs` — embedded payloads are intact

Decodes every base64 `data:` URI in `theme.css`: font payloads must start with a
recognisable font signature, SVG payloads must decode to well-formed XML starting
with `<svg`, every payload must survive a base64 round trip, and every payload must
match a file in `src/assets/` by SHA-256 (no orphan payloads, no unused files).

Counts are pinned: 17 `@font-face` blocks = 17 font files (12 `.woff2` + 5 `.ttf`);
52 SVG references = 27 distinct payloads = 27 icon files.

**Fails when:** a font or icon is corrupted during extraction, a directive is
mis-expanded by the build, or an asset is renamed on one side only.

**Also asserts** `docs/KNOWN-ISSUES.md` #8 is fixed: every font payload's MIME
label must match the container its magic bytes actually hold — 12 `font/woff2` and
5 `font/ttf` — so a payload can no longer declare a container it does not carry.

### `manifest.test.mjs` — the release metadata is coherent

`manifest.json` has the required fields, `versions.json` contains the current
version and is sorted ascending, the version string rendered inside `theme.css`
matches the manifest, the codename travels with it, and the GPL banner is intact.

### `version.test.mjs` — the three version records agree

Drives `scripts/check-version.mjs` and asserts its behaviour: the JSON contract,
exit codes, and — using a scratch copy in `mkdtempSync` so the real metadata is
never touched — that it *passes* when the three records agree and *fails* for each
of the three ways they can disagree.

**Note:** `check-version` now exits 0 — `versions.json` agrees with `manifest.json`
on the 1.13 compatibility floor, and the test asserts **zero** consistency errors.
It used to assert the failure existed; the pin was flipped when the data was fixed.
See `docs/KNOWN-ISSUES.md` #1.

### `budget.test.mjs` — the file does not creep back

Four independent budgets, split by *cause* because the two failure modes are
unrelated:

| budget | today | limit | catches |
|---|---|---|---|
| whole `theme.css` | 5.02 MB | 6.50 MB | someone inlined an entire icon set |
| readable CSS (excl. base64) | 2.05 MB | 2.50 MB | **the real growth guard** |
| `src/assets/fonts/` (unencoded) | 2.20 MB / 17 files (12 .woff2 + 5 .ttf) | 3.00 MB, exactly 17 | careless font addition |
| longest rule block | 160 lines | 250 lines | a missing `}` swallowing neighbours |

The whole-file ceiling has ~1.5 MB of headroom (roughly one more font) on purpose:
it is an alarm, not the guard. Fonts dominate the artifact — 58.6% of the shipped
bytes are base64 font payloads — so growth there is tracked at the source, where
the number is the real font size rather than its 4/3 base64 inflation. The number
that matters for maintainability is the 2.05 MB of CSS a human actually reads.

### `stylelint.test.mjs` — the lint baseline cannot rot

Runs stylelint and asserts **zero errors**, that the warning count is **pinned
per rule, exactly** — the `EXPECTED_WARNINGS` map sums to **128** — and that the
two formerly-pinned lint defects in `docs/KNOWN-ISSUES.md` #5 and #6 are pinned in
their fixed state: `declaration-block-no-shorthand-property-overrides` is **0**
(was 2) and `declaration-block-no-duplicate-properties` is **10** (was 37). A
loosened config cannot hide either.

Why exact counts and not a threshold: `pnpm run lint:css` exits 0 because every
rule that fires on inherited upstream code is demoted to `warning`. Once that is
true, a ceiling only catches *growth* — it cannot catch a rule that silently
stops firing, which is exactly what happens when a rule name is typo'd, an
`extends` is dropped, or a `null` in the config is reverted by accident. An
equality check catches both directions, and the failure message says which one
it was:

- more warnings → new debt; fix it or record it in KNOWN-ISSUES
- fewer warnings → either the code was fixed (lower the pin) or the rule died (check the config)
- a rule not in the map → a new rule started firing; register or suppress it deliberately

---

## Layout

```
tests/
  build.test.mjs         artifact == source, and == pinned baseline hash
  structure.test.mjs     every src/ partial is valid on its own; include tree is whole
  syntax.test.mjs        theme.css is valid Obsidian CSS (braces, comments, BOM, CRLF)
  style-settings.test.mjs  12 YAML panels: ids, types, uniqueness, liveness
  variables.test.mjs     var() references vs definitions, against a registered allowlist
  assets.test.mjs        base64 payloads decode; fonts and icons match src/assets/
  manifest.test.mjs      manifest.json / versions.json / rendered version string
  version.test.mjs       scripts/check-version.mjs behaviour, incl. the formerly-pinned failure
  budget.test.mjs        size and block-length budgets
  stylelint.test.mjs     lint baseline (zero errors, per-rule warning pins)
  helpers/css.mjs        shared loaders: theme.css is read+parsed once and memoised
  fixtures/obsidian-builtins.json   the registered allowlist for variables.test.mjs
```

Test files are one per concern. `node --test` runs them in parallel, so anything
expensive (parsing 5 MB of CSS, running stylelint) is memoised inside
`helpers/css.mjs` and inside the individual lint test.

## Conventions

- **Assert the observable effect, not the implementation.** Count real warnings,
  parse real CSS, decode real bytes — do not assert on intermediate strings a
  refactor would legitimately change.
- **Pin defects, do not hide them.** A known upstream bug gets a test asserting it
  exists at a fixed location. Fixing it turns the test red, which is the reminder
  to clean up. Never write `assert.ok(count >= 1)` for a defect — write the exact
  count and location. When the defect is fixed, **flip the pin** to assert the
  fixed state rather than deleting the test: the assertion still has a job, now
  guarding against the defect coming back.
- **Skip loudly, never silently.** If a dependency is missing, call `t.skip(reason)`
  with a message that says what to install. A test that silently passes because it
  could not run is worse than no test.
- **Diagnostics are not failures.** Things worth knowing but not worth blocking CI
  on are printed via `t.diagnostic()`.
