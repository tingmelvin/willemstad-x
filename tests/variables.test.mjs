/**
 * tests/variables.test.mjs — the typo detector.
 *
 * `var(--x)` with an undefined `--x` does not error: the declaration is simply
 * dropped (or falls back to whatever the second argument says). So a typo like
 * `var(--text-nomral)` produces a theme that looks 99% right and is silently
 * wrong in one place. Nothing in CSS tooling catches it, and it is invisible in
 * a 5 MB file.
 *
 * The rule enforced here:
 *
 *   every var(--x) reference must either
 *     (a) have a `--x:` definition in theme.css, or
 *     (b) be registered in tests/fixtures/obsidian-builtins.json
 *
 * Adding a *new* undefined variable therefore requires editing the fixture with
 * a written reason — which is exactly the moment a human notices "wait, that's a
 * typo". That is the whole value of this test; it is not trying to prove the
 * theme is correct, it is trying to make new mistakes expensive.
 *
 * The allowlist is derived from the real v1.11.1 stylesheet and reviewed by hand;
 * see the `$comment` block in the fixture for how each category was classified.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ROOT, variableUsage, themeRoot } from './helpers/css.mjs';

const FIXTURE_PATH = path.join(ROOT, 'tests', 'fixtures', 'obsidian-builtins.json');
const allowlist = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

const { refs, defs, undefinedVars } = variableUsage(themeRoot());

const allowlisted = new Set([
  ...allowlist.obsidianBuiltin,
  ...allowlist.styleSettingsInjected,
  ...allowlist.externallyProvided.map((t) => t.name),
]);

const patternMatchers = allowlist.patterns.map((p) => ({ ...p, re: new RegExp(p.regex) }));
const matchesPattern = (name) => patternMatchers.find((p) => p.re.test(name)) ?? null;

// ---------------------------------------------------------------------------
// the core contract
// ---------------------------------------------------------------------------

test('every undefined var() reference is registered in the allowlist', () => {
  const unregistered = undefinedVars.filter((v) => !allowlisted.has(v) && !matchesPattern(v));
  assert.deepEqual(
    unregistered,
    [],
    `${unregistered.length} custom propert${unregistered.length === 1 ? 'y is' : 'ies are'} referenced with var() ` +
      'but never defined, and not registered in tests/fixtures/obsidian-builtins.json:\n' +
      unregistered.map((v) => `  ${v}  (referenced ${refs.get(v)}x)`).join('\n') +
      '\n\nThis is usually a typo. Check the spelling against the defined properties\n' +
      '(`node -e "..."` or grep for a similar name). If the variable really is external\n' +
      '(provided by Obsidian, by the Style Settings plugin, or by a user snippet), add it\n' +
      'to the right array in the fixture with a one-line reason.',
  );
});

test('the allowlist contains no stale entries', () => {
  // An allowlisted variable that is no longer referenced (or is now defined) is
  // dead weight. Pruning it keeps the list honest and short enough to review.
  const refSet = new Set(refs.keys());
  const stale = [];
  for (const v of allowlist.obsidianBuiltin) if (!refSet.has(v)) stale.push(`obsidianBuiltin: ${v}`);
  for (const v of allowlist.styleSettingsInjected) if (!refSet.has(v)) stale.push(`styleSettingsInjected: ${v}`);
  for (const t of allowlist.externallyProvided) if (!refSet.has(t.name)) stale.push(`externallyProvided: ${t.name}`);
  assert.deepEqual(stale, [], `allowlist entries that are no longer referenced (delete them):\n  ${stale.join('\n  ')}`);
});

test('no allowlisted variable is actually defined (that would be a stale exemption)', () => {
  const definedButAllowlisted = [...allowlisted].filter((v) => defs.has(v));
  assert.deepEqual(
    definedButAllowlisted,
    [],
    `these variables ARE defined in theme.css but are still in the allowlist — remove them:\n  ${definedButAllowlisted.join('\n  ')}`,
  );
});

test('pattern categories match exactly the variables they claim', () => {
  const counts = new Map();
  for (const v of undefinedVars) {
    const p = matchesPattern(v);
    if (p) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  }
  for (const p of patternMatchers) {
    const actual = counts.get(p.name) ?? 0;
    assert.equal(
      actual,
      p.count,
      `pattern "${p.name}" (${p.regex}) now matches ${actual} variables, fixture says ${p.count}.\n` +
        'If the colour system grew on purpose, update `count` in the fixture so the change is visible in review.',
    );
  }
});

test('the fixture is consistent with the file it was generated from', () => {
  // Cheap drift alarm: if theme.css changes but nobody regenerates the fixture,
  // the counts above go stale in a confusing way. This makes the cause obvious.
  assert.equal(typeof allowlist.generatedFrom?.themeCssBytes, 'number', 'fixture is missing generatedFrom metadata');
  assert.equal(
    allowlist.generatedFrom.refs,
    refs.size,
    `fixture was generated from a stylesheet with ${allowlist.generatedFrom.refs} var() references, ` +
      `theme.css now has ${refs.size}. Regenerate the fixture (see tests/README.md).`,
  );
});

// ---------------------------------------------------------------------------
// sanity of the analysis itself
// ---------------------------------------------------------------------------

test('the scan actually found a meaningful number of variables', () => {
  assert.ok(refs.size > 1000, `only ${refs.size} var() references found — the AST walk is broken`);
  assert.ok(defs.size > 900, `only ${defs.size} custom-property definitions found — the AST walk is broken`);
  assert.ok(undefinedVars.length > 300, `only ${undefinedVars.length} undefined variables — suspiciously few`);
});

test('no variable is referenced with an empty or malformed name', () => {
  const malformed = [...refs.keys()].filter((v) => !/^--[A-Za-z0-9_-]+$/.test(v));
  assert.deepEqual(malformed, [], `malformed custom property names: ${malformed.join(', ')}`);
});

test('no custom property is defined twice with a bare "var(--x: ...)" typo', () => {
  // `var(--x: 10px)` is a parse-valid but meaningless "definition inside a var()".
  const text = themeTextSafe();
  const hits = [...text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(hits)], [], `var() used with a colon (looks like a definition typo): ${[...new Set(hits)].join(', ')}`);
});

function themeTextSafe() {
  // imported lazily to keep the module graph small in the hot tests
  return readFileSync(path.join(ROOT, 'theme.css'), 'utf8');
}

// ---------------------------------------------------------------------------
// diagnostics (never fail) — externally provided properties
// ---------------------------------------------------------------------------

test('diagnostic: externally provided properties (reported, not failed)', (t) => {
  // These are undefined in theme.css on purpose: something outside the theme
  // supplies them at runtime. They were originally classified as "suspected
  // typos"; five of the nine really were defects and were fixed (KNOWN-ISSUES
  // #4), which is what narrowed this list to four.
  //
  // Reported rather than asserted, because "externally provided" is a judgement
  // that has not been checked against Obsidian's app.css — the environment this
  // was written in could not fetch it. If one of these turns out to be a typo
  // after all, this diagnostic is where it will be visible.
  const found = allowlist.externallyProvided.filter((x) => refs.has(x.name));
  t.diagnostic(
    `${found.length} undefined propert${found.length === 1 ? 'y is' : 'ies are'} supplied outside the theme ` +
      '(docs/KNOWN-ISSUES.md, "Remaining"):\n' +
      found.map((x) => `  ${x.name}  (${refs.get(x.name)}x) — ${x.provider}\n      ${x.why}`).join('\n'),
  );
  assert.equal(
    found.length,
    allowlist.externallyProvided.length,
    'an externally-provided property disappeared from theme.css — update the fixture',
  );
});
