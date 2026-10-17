/**
 * tests/build.test.mjs — the most important regression test in this repo.
 *
 * `src/` is the source of truth; `theme.css` is a build artifact that happens to
 * be committed (Obsidian installs it directly). This test proves the two agree
 * byte for byte, so a "refactor" that changes a single character of the shipped
 * stylesheet fails CI instead of shipping silently.
 *
 * The same file also pins a baseline hash for theme.css, so a change to the
 * shipped bytes has to be acknowledged rather than merely rebuilt. Together they
 * form a chain:
 *
 *   src/  ==build==>  theme.css  ==sha256==>  pinned baseline
 *
 * If the build check passes but the baseline assertion fails, the theme changed on
 * purpose. Update `THEME_SHA256` and say so in the commit message.
 *
 * Note: during the infrastructure milestone the pin was the *upstream* v1.11.1
 * hash, proving the split changed nothing. That invariant was retired when the
 * known defects were fixed — see docs/KNOWN-ISSUES.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ROOT, THEME_PATH, PUBLISH_PATH, SRC_DIR, themeBytes, sha256, rel } from './helpers/css.mjs';

/**
 * The fork's current baseline for theme.css.
 *
 * History: during the infrastructure milestone this was pinned to the *upstream*
 * v1.11.1 hash (`f223ca9d…`) to prove the src/ split was byte-lossless. That
 * invariant was retired deliberately when the eight known defects were fixed
 * (see docs/KNOWN-ISSUES.md) — keeping it would have blocked the fixes. The pin
 * still does its real job: any change to the shipped bytes has to be noticed and
 * acknowledged here.
 */
const THEME_SHA256 = 'a66dd63c510291dc2170196e3f64eb10a6e265aef1b51283f924c072b82320c2';
const THEME_BYTES = 5_258_014;

/** publish.css is the frozen v0.5.4 track: not built from src/, must not move. */
const PUBLISH_SHA256 = 'b3fc5fed16567bb32ac9f7ea72e10eba81697c22930e7b8347bdef1622b3adb1';
const PUBLISH_BYTES = 247_883;

const ENTRY = path.join(SRC_DIR, 'entries', 'theme.css');
const hasEntry = () => existsSync(ENTRY);
const runNode = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });

// ---------------------------------------------------------------------------
// build --check
// ---------------------------------------------------------------------------

test('src/ is present (extraction has run)', (t) => {
  if (!existsSync(SRC_DIR)) {
    t.skip('src/ does not exist yet — run `node scripts/extract.mjs` first');
    return;
  }
  assert.ok(hasEntry(), 'src/entries/theme.css manifest is missing');
});

test('build --check: src/ rebuilds theme.css byte for byte', (t) => {
  if (!hasEntry()) {
    t.skip('src/entries/theme.css not generated yet');
    return;
  }
  const r = runNode(['scripts/build.mjs', '--check']);
  const output = `${r.stdout}${r.stderr}`.trim();
  assert.equal(
    r.status,
    0,
    `build --check failed (exit ${r.status}).\n` +
      'A non-zero exit means src/ no longer reproduces the committed theme.css.\n' +
      'Fix the source, then run `node scripts/build.mjs` and review the diff — or, if the\n' +
      'change is intentional, rebuild and commit both.\n\n' +
      output,
  );
  assert.match(output, /build check passed/, 'expected the success banner in build output');
});

test('build --check is deterministic (running twice gives the same verdict)', (t) => {
  if (!hasEntry()) {
    t.skip('src/entries/theme.css not generated yet');
    return;
  }
  const first = runNode(['scripts/build.mjs', '--check']);
  const second = runNode(['scripts/build.mjs', '--check']);
  assert.equal(first.status, 0, 'first build --check failed');
  assert.equal(second.status, 0, 'second build --check failed — build is not deterministic');
});

test('build --audit: include tree is consistent', (t) => {
  if (!hasEntry()) {
    t.skip('src/entries/theme.css not generated yet');
    return;
  }
  const r = runNode(['scripts/build.mjs', '--audit']);
  const output = `${r.stdout}${r.stderr}`.trim();
  assert.equal(r.status, 0, `build --audit reported a problem:\n${output}`);
  assert.match(output, /tree is consistent/, `unexpected audit output:\n${output}`);
});

// ---------------------------------------------------------------------------
// baseline hashes
// ---------------------------------------------------------------------------

test('theme.css matches the pinned baseline', () => {
  const bytes = themeBytes();
  assert.equal(bytes.length, THEME_BYTES, `${rel(THEME_PATH)} changed size`);
  assert.equal(
    sha256(bytes),
    THEME_SHA256,
    `${rel(THEME_PATH)} no longer matches the pinned baseline.\n` +
      'If this change is intentional: rebuild, update THEME_SHA256/THEME_BYTES in\n' +
      'tests/build.test.mjs, and say why in the commit message.',
  );
});

test('publish.css is untouched (frozen v0.5.4 track)', () => {
  assert.ok(existsSync(PUBLISH_PATH), 'publish.css is missing');
  const bytes = readFileSync(PUBLISH_PATH);
  assert.equal(bytes.length, PUBLISH_BYTES, 'publish.css changed size');
  assert.equal(
    sha256(bytes),
    PUBLISH_SHA256,
    'publish.css changed. It is a frozen legacy track: it is not built from src/ and must not\n' +
      'be edited by hand. If a deliberate change is needed, update PUBLISH_SHA256 in this test.',
  );
});

// ---------------------------------------------------------------------------
// artifact sanity
// ---------------------------------------------------------------------------

test('theme.css is a plausible artifact size', () => {
  const size = themeBytes().length;
  assert.ok(size > 1_000_000, 'theme.css is suspiciously small');
  assert.ok(size < 6 * 1024 * 1024, 'theme.css exceeds the 6 MB budget (see budget.test.mjs)');
});
