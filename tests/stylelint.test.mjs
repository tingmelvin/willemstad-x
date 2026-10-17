/**
 * stylelint.test.mjs — pin the lint baseline so it cannot rot.
 *
 * `pnpm run lint:css` must exit 0 (it is a CI gate). That alone is not enough:
 * a config that reports 1,700 warnings is green and useless, and a config that
 * silently stops reporting a real defect is green and dangerous. So this test
 * asserts three things the exit code cannot express:
 *
 *   1. Zero *errors*. Errors are reserved for "this CSS is wrong", so any error
 *      is a regression, full stop.
 *   2. The warning count is pinned **per rule, exactly**. A ceiling only catches
 *      growth; it cannot catch a rule that silently stops firing because the
 *      config was loosened or its rule was renamed. Exact counts catch both.
 *   3. The two genuine defects documented in docs/KNOWN-ISSUES.md are still
 *      being *reported*. If a config change hides them, this goes red.
 *
 * Why not just fail on warnings? Because the existing warnings are upstream
 * artefacts that cannot be fixed in this refactor without changing rendered
 * output (see KNOWN-ISSUES #5 and #6). Turning them into errors would mean
 * either a permanently red build or a blanket suppression — both hide more than
 * they reveal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

/**
 * Total warnings we tolerate today. Kept equal to the sum of EXPECTED_WARNINGS so
 * it is a real bound rather than a number that can never fire; the per-rule map
 * below is the stricter check and will normally fail first, with a better message.
 */
const WARNING_CEILING = 128;

/**
 * Exact warning count per rule, measured on the current src/ tree.
 *
 * Why exact and not a ceiling: once every rule is demoted to `warning` (so the
 * CI gate can be green), nothing fails if a rule quietly stops reporting —
 * a typo in a rule name, a dropped `extends`, a rule switched to `null` by
 * accident. A ceiling cannot see that; a per-rule equality can.
 *
 * The numbers may go DOWN freely (fix something, lower the pin). Going UP needs
 * a KNOWN-ISSUES entry, because it means new debt was accepted.
 */
const EXPECTED_WARNINGS = {
  'no-duplicate-selectors': 74,
  'declaration-property-value-no-unknown': 16,
  'property-no-deprecated': 14,
  'declaration-block-no-duplicate-properties': 10,
  'font-family-no-missing-generic-family-keyword': 9,
  'declaration-block-no-duplicate-custom-properties': 4,
  'function-url-quotes': 1,
};
// Total: 128. Two rules dropped out when the known defects were fixed:
//   declaration-block-no-shorthand-property-overrides  2 -> 0  (KNOWN-ISSUES #5)
//   declaration-block-no-duplicate-properties         37 -> 10 (KNOWN-ISSUES #6)
// A rule that reports nothing does not appear here at all — see the test that
// checks the pinned total against what stylelint actually reports.

let cached = null;

/** Run stylelint once; every test below reads the same result. */
async function lint() {
  if (cached) return cached;

  const configPath = path.join(ROOT, 'stylelint.config.mjs');
  if (!fs.existsSync(configPath)) {
    cached = { skipped: true, reason: 'stylelint.config.mjs not found' };
    return cached;
  }

  const bin = path.join(ROOT, 'node_modules', 'stylelint', 'bin', 'stylelint.mjs');
  if (!fs.existsSync(bin)) {
    cached = { skipped: true, reason: 'stylelint is not installed (run pnpm install)' };
    return cached;
  }

  // The JSON report for ~140 files is a few MB, well past execFile's 1 MB
  // default. Raise it explicitly — truncation would look like "no warnings",
  // which is the worst possible failure mode for a baseline test.
  //
  // Note: stylelint writes the JSON formatter's output to **stderr**, not stdout
  // (it reserves stdout for the human-readable formatter). Reading only stdout
  // yields an empty string, which this test would then treat as "nothing to
  // report" — silently passing. Both streams are collected and the JSON is
  // located by its leading bracket.
  const run = () =>
    new Promise((resolve) => {
      execFile(
        process.execPath,
        [bin, 'src/**/*.css', '--formatter', 'json'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
        (err, stdout, stderr) => {
          // A non-zero exit just means "findings exist"; the JSON is still valid.
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: err?.code ?? 0 });
        },
      );
    });

  const { stdout, stderr } = await run();
  const raw = (stdout.trim().startsWith('[') ? stdout : stderr).trim();

  if (!raw) {
    cached = { skipped: true, reason: 'stylelint produced no output' };
    return cached;
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch (err) {
    cached = { skipped: true, reason: `stylelint output was not JSON: ${err.message}` };
    return cached;
  }
  const results = Array.isArray(report) ? report : [report];

  let errors = 0;
  let warnings = 0;
  const byRule = new Map();
  const all = [];
  for (const r of results) {
    for (const w of r.warnings ?? []) {
      if (w.severity === 'error') errors++;
      else warnings++;
      byRule.set(w.rule, (byRule.get(w.rule) ?? 0) + 1);
      all.push({ file: r.source ?? r.input ?? '?', ...w });
    }
  }

  cached = { skipped: false, errors, warnings, byRule, all };
  return cached;
}

test('stylelint reports zero errors', async (t) => {
  const r = await lint();
  if (r.skipped) return t.skip(r.reason);

  if (r.errors > 0) {
    const offenders = r.all.filter((w) => w.severity === 'error').slice(0, 10);
    const detail = offenders.map((w) => `  ${w.file}:${w.line}:${w.column}  ${w.rule}  ${w.text}`).join('\n');
    assert.fail(`${r.errors} stylelint error(s) — errors mean the CSS is wrong:\n${detail}`);
  }
  assert.equal(r.errors, 0);
});

test('stylelint warning count has not grown', async (t) => {
  const r = await lint();
  if (r.skipped) return t.skip(r.reason);

  const top = [...r.byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const summary = top.map(([rule, n]) => `  ${String(n).padStart(4)}  ${rule}`).join('\n');

  assert.ok(
    r.warnings <= WARNING_CEILING,
    `${r.warnings} warnings exceeds the pinned ceiling of ${WARNING_CEILING}.\n` +
      `Fix the new warnings, or raise WARNING_CEILING deliberately.\n\nTop rules:\n${summary}`,
  );
});

test('the per-rule warning budget is exact, in both directions', async (t) => {
  const r = await lint();
  if (r.skipped) return t.skip(r.reason);

  const known = Object.keys(EXPECTED_WARNINGS);
  const seen = [...r.byRule.keys()];

  // A rule that fires but is not in the map: either a new rule was enabled by a
  // stylelint-config-standard upgrade, or a `null` in stylelint.config.mjs was
  // reverted. Either way it must be reviewed, not silently tolerated.
  const unregistered = seen.filter((rule) => !(rule in EXPECTED_WARNINGS));
  assert.deepEqual(
    unregistered,
    [],
    `${unregistered.length} rule(s) report warnings but are not registered in EXPECTED_WARNINGS:\n` +
      unregistered.map((rule) => `  ${rule}: ${r.byRule.get(rule)}`).join('\n') +
      '\n\nEither switch the rule off in stylelint.config.mjs with a written reason, or add it\n' +
      'to EXPECTED_WARNINGS so its count is pinned too.',
  );

  const drift = [];
  for (const rule of known) {
    const expected = EXPECTED_WARNINGS[rule];
    const actual = r.byRule.get(rule) ?? 0;
    if (actual === expected) continue;
    drift.push(
      actual > expected
        ? `  ${rule}: expected ${expected}, got ${actual} — NEW warnings; fix them or record the debt`
        : `  ${rule}: expected ${expected}, got ${actual} — FEWER warnings; either the code was fixed ` +
          '(lower the pin) or the rule stopped firing (check the config)',
    );
  }
  assert.deepEqual(drift, [], `the lint baseline moved:\n${drift.join('\n')}`);
});

test('the pinned budget accounts for every warning stylelint reports', async (t) => {
  const r = await lint();
  if (r.skipped) return t.skip(r.reason);

  const pinnedTotal = Object.values(EXPECTED_WARNINGS).reduce((a, b) => a + b, 0);
  assert.equal(
    r.warnings,
    pinnedTotal,
    `stylelint reports ${r.warnings} warnings but EXPECTED_WARNINGS sums to ${pinnedTotal}. ` +
      'The per-rule map is out of sync with reality.',
  );
});

test('the shorthand-override defect is gone (KNOWN-ISSUES #5, fixed)', async (t) => {
  const r = await lint();
  if (r.skipped) return t.skip(r.reason);

  // Upstream had two blocks where `border-color` was immediately overwritten by a
  // `border` shorthand carrying the same value. The dead longhands were deleted.
  // This test used to assert the rule fired; it now asserts it stays silent, so a
  // reintroduced shadowed longhand is caught immediately.
  const n = r.byRule.get('declaration-block-no-shorthand-property-overrides') ?? 0;
  assert.equal(
    n,
    0,
    `${n} declaration(s) are still shadowed by a later shorthand. A longhand that a\n` +
      'following shorthand overwrites is dead code — delete it, or reorder if the\n' +
      'longhand was meant to win.',
  );
});

test('no consecutive duplicate declarations remain (KNOWN-ISSUES #6, fixed)', async (t) => {
  const r = await lint();
  if (r.skipped) return t.skip(r.reason);

  // Upstream, src/overrides/*-x102.css carried `font-size: 0;` twice in a row 27
  // times. Those were collapsed; the remaining 10 are duplicate declarations with
  // *different* values elsewhere, which may be intentional fallbacks and are not
  // touched. Pin the number so it cannot creep back up.
  const n = r.byRule.get('declaration-block-no-duplicate-properties') ?? 0;
  assert.ok(
    n <= 10,
    `${n} duplicate-property warnings, expected at most 10. The 27 consecutive\n` +
      '`font-size: 0` pairs were removed; new ones are new debt — fix them or\n' +
      'explain why in the commit message and raise this number deliberately.',
  );
});

test('the lint target is src/, not the generated theme.css', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const script = pkg.scripts?.['lint:css'] ?? '';

  assert.match(script, /src\//, 'lint:css must target src/');
  assert.doesNotMatch(
    script,
    /theme\.css/,
    'lint:css must not lint theme.css — it is generated and byte-compared, so linting it reports on a file nobody may edit',
  );
});
