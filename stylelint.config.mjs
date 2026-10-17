/**
 * stylelint.config.mjs — CSS static analysis for the Willemstad-X fork.
 *
 * Philosophy
 * ----------
 * `pnpm run lint:css` is a CI gate, so it has to mean something. A config that
 * fires 1,700 times gets ignored; a config that fires zero times catches nothing.
 * The split below is therefore deliberate:
 *
 *   error   — things that are *wrong*: CSS that will not parse, or a declaration
 *             that is silently dead because a later shorthand overwrote it.
 *             This is the only severity that fails the build.
 *
 *   warning — real smells that cannot be fixed in this refactor without changing
 *             rendered output (deprecated-but-still-honoured properties, duplicate
 *             declarations inherited from the upstream author's workflow).
 *             Warnings are counted by tests/stylelint.test.mjs, so the number
 *             cannot grow silently.
 *
 *   null    — rules that are simply wrong for this codebase. Every one is
 *             annotated with the reason it is off.
 *
 * The theme targets Obsidian's bundled Electron (a recent Chromium), so modern
 * CSS is not "unknown": `@container style()`, nesting, `oklch(from …)`,
 * `calc-size()`, `text-box-trim` and friends are all intentional. Anything that
 * flags them is off.
 *
 * Run:
 *   pnpm run lint:css        # src/ only (theme.css is generated — never edit it)
 *   pnpm run lint:css:fix    # autofix the safe subset
 */

export default {
  extends: ['stylelint-config-standard'],

  ignoreFiles: [
    // Generated artifacts: the build output is byte-compared, never linted.
    'theme.css',
    'publish.css',
    // Historical snapshots (v0.0.x … v1.9.x) and the frozen v0.5.4 track.
    'archive/**',
    // Binary assets. Base64 payloads are embedded by the build, not by hand.
    'src/assets/**',
  ],

  rules: {
    // ---------------------------------------------------------------------
    // Correctness smells inherited from upstream — pinned as warnings
    // ---------------------------------------------------------------------

    // `border-color: …; border: …` makes the first declaration dead. Two
    // instances in src/modals/094-mc02.css (KNOWN-ISSUES "Bug E"). Kept at
    // warning, not error, because fixing it changes the rendered border colour.
    'declaration-block-no-shorthand-property-overrides': [true, { severity: 'warning' }],

    // 37 hits, dominated by 27 consecutive `font-size: 0;` pairs in
    // src/overrides/127-x102.css (KNOWN-ISSUES "Bug F") plus duplicate
    // `mask-image` directives. Harmless to render, noise to maintain.
    'declaration-block-no-duplicate-properties': [
      true,
      { ignore: ['consecutive-duplicates-with-different-syntaxes'], severity: 'warning' },
    ],
    'declaration-block-no-duplicate-custom-properties': [true, { severity: 'warning' }],
    'no-duplicate-selectors': [true, { severity: 'warning' }],

    // `page-break-after`, `grid-gap`, `word-wrap`: still honoured by Chromium.
    // Rewriting them is a behaviour change, out of scope for a refactor.
    'property-no-deprecated': [true, { severity: 'warning' }],

    // Icon fonts (remixicon, MathJax) intentionally have no generic fallback:
    // a fallback glyph is worse than no glyph for a private-use codepoint font.
    'font-family-no-missing-generic-family-keyword': [true, { severity: 'warning' }],

    'function-url-quotes': ['always', { severity: 'warning' }],

    // Kept on because it is the one rule that catches a genuine typo in a
    // declaration value. All 16 current hits are false positives — either
    // modern CSS the bundled value parser does not know yet (`calc-size()`,
    // `text-box-trim`, `-webkit-fill-available`) or build-directive
    // placeholders (`mask-image: /*@svg … */;` is empty until the build runs).
    // Left as a warning so a *new* value typo still shows up in the report.
    'declaration-property-value-no-unknown': [true, { severity: 'warning' }],

    // ---------------------------------------------------------------------
    // Off — incompatible with this codebase, not with CSS
    // ---------------------------------------------------------------------

    // 588 hits. This theme compiles SCSS-authored rules to flat CSS and relies
    // on source order for the cascade; "descending specificity" is the design.
    'no-descending-specificity': null,

    // 404 hits. Obsidian and its plugins ship BEM (`kanban-plugin__lane`) and
    // PascalCase (`ToolIcon`, `.Modal`) classes that the theme must match
    // verbatim. Renaming is impossible.
    'selector-class-pattern': null,
    'selector-id-pattern': null,
    'keyframes-name-pattern': null,

    // 88 hits. The theme's own convention is `--PComm002-CB-dot-size`:
    // section prefix in caps, then kebab-case. Changing it breaks Style Settings.
    'custom-property-pattern': null,

    // 55 hits. `hsl(210, 10%, 90%)` legacy syntax is used deliberately — it is
    // what Obsidian's own variables emit, and colour values are copied from the
    // app. Converting to space-separated syntax is churn with no user impact.
    'color-function-notation': null,

    // 50 hits. Colour maths (`oklch(82.77% 0.1667 79.6deg)`) needs the
    // precision; these numbers are generated, not typed.
    'number-max-precision': null,

    // 167 + 154 hits. The theme documents every block with `/* comment */`
    // inline and uses `/*text*/` without inner padding as a section marker.
    // Reformatting 321 comments would bury the real diff.
    'comment-whitespace-inside': null,
    'comment-empty-line-before': null,

    // 17 hits, all `format("woff2-variations")` — a valid CSS Fonts 4 value the
    // bundled data table does not list. Rule bug, not a code bug.
    'at-rule-descriptor-value-no-unknown': null,
  },
};
