/**
 * tests/manifest.test.mjs — the release metadata Obsidian actually reads.
 *
 * Obsidian decides "should this user get an update?" from three files:
 *
 *   manifest.json   { name, version, minAppVersion, author }
 *   versions.json   { "<theme version>": "<min app version>", … }
 *   theme.css       prints its own version in the titlebar and theme modal
 *
 * Getting any of them wrong is invisible in development and user-visible in
 * production: a theme whose `version` is missing from versions.json is never
 * offered as an update, and a stale version string in the CSS makes the user
 * think they are running an old build.
 *
 * The consistency *logic* is in scripts/check-version.mjs; this file tests the
 * invariants that must hold regardless of that script (and tests the script's
 * known-failing state in tests/version.test.mjs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MANIFEST_PATH, VERSIONS_PATH, themeText } from './helpers/css.mjs';

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const versions = JSON.parse(readFileSync(VERSIONS_PATH, 'utf8'));
const text = themeText();

const semverParts = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
const cmp = (a, b) => {
  const [a1, a2, a3] = semverParts(a);
  const [b1, b2, b3] = semverParts(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
};

// ---------------------------------------------------------------------------
// manifest.json
// ---------------------------------------------------------------------------

test('manifest.json has every field Obsidian requires', () => {
  for (const field of ['name', 'version', 'minAppVersion', 'author']) {
    assert.equal(typeof manifest[field], 'string', `manifest.json: "${field}" must be a string`);
    assert.ok(manifest[field].trim().length > 0, `manifest.json: "${field}" must not be empty`);
  }
});

test('manifest.json version is strict x.y.z', () => {
  assert.match(
    manifest.version,
    /^\d+\.\d+\.\d+$/,
    `manifest.json version "${manifest.version}" is not x.y.z. Obsidian compares versions ` +
      'lexicographically-ish; pre-release suffixes silently break the update check.',
  );
  assert.match(manifest.minAppVersion, /^\d+\.\d+\.\d+$/, `minAppVersion "${manifest.minAppVersion}" is not x.y.z`);
});

test('manifest.json minAppVersion is not below the floor recorded for this release', () => {
  // versions.json is the historical record of "which Obsidian versions were
  // supported by which theme release". Lowering minAppVersion for a version that
  // was already published would silently offer the theme to users who cannot run
  // it, so the manifest may only move *up* relative to what is recorded.
  if (!Object.hasOwn(versions, manifest.version)) return; // reported by version.test.mjs
  const recorded = versions[manifest.version];
  assert.ok(
    cmp(manifest.minAppVersion, recorded) >= 0,
    `manifest.json minAppVersion ${manifest.minAppVersion} is LOWER than the value recorded ` +
      `in versions.json["${manifest.version}"] = ${recorded}. Raising support after release is fine; ` +
      'lowering it would offer the theme to app versions that were never tested.',
  );
});

test('manifest.json name is stable (changing it re-installs the theme as a different one)', () => {
  assert.equal(manifest.name, 'Willemstad', 'the theme name is the identity Obsidian keys installs by');
});

// ---------------------------------------------------------------------------
// versions.json
// ---------------------------------------------------------------------------

test('versions.json contains the current manifest version as a key', () => {
  assert.ok(
    Object.hasOwn(versions, manifest.version),
    `versions.json has no "${manifest.version}" key. Obsidian reads this map to decide whether ` +
      'to offer the update — without the key, existing users never see the new release.',
  );
});

test('versions.json values are all strict x.y.z strings', () => {
  const bad = Object.entries(versions).filter(([, v]) => !/^\d+\.\d+\.\d+$/.test(String(v)));
  assert.deepEqual(bad, [], `versions.json entries with a malformed minAppVersion: ${JSON.stringify(bad)}`);
});

test('versions.json keys are in ascending order (append-only history)', () => {
  const keys = Object.keys(versions);
  for (let i = 1; i < keys.length; i++) {
    assert.ok(
      cmp(keys[i], keys[i - 1]) > 0,
      `versions.json is not sorted: "${keys[i - 1]}" comes before "${keys[i]}".\n` +
        'The file is the release history; out-of-order entries make diffs unreadable and hide\n' +
        'accidental rollbacks. scripts/bump-version.mjs sorts on write.',
    );
  }
});

test('the current version is the newest key in versions.json', () => {
  const newest = Object.keys(versions).sort(cmp).at(-1);
  assert.equal(
    newest,
    manifest.version,
    `manifest.json says ${manifest.version} but versions.json's newest entry is ${newest}. ` +
      'Either the manifest was rolled back or a release was recorded without bumping.',
  );
});

// ---------------------------------------------------------------------------
// theme.css version banner
// ---------------------------------------------------------------------------

test('theme.css prints the manifest version', () => {
  const mentions = [...new Set(text.match(/v\d+\.\d+\.\d+/g) ?? [])];
  assert.deepEqual(
    mentions,
    [`v${manifest.version}`],
    `theme.css mentions ${mentions.join(', ') || 'no version'}; manifest.json says v${manifest.version}. ` +
      'Rebuild after bumping the manifest (node scripts/build.mjs).',
  );
});

test('theme.css prints the version at least twice (titlebar + theme modal)', () => {
  const re = new RegExp(`v${manifest.version.replace(/\./g, '\\.')}`, 'g');
  const count = (text.match(re) ?? []).length;
  assert.ok(
    count >= 2,
    `v${manifest.version} appears ${count}x in theme.css. The theme prints it in the titlebar ` +
      'suffix and the community-theme modal; one of them lost its version string.',
  );
});

test('theme.css carries the release codename', () => {
  // The banner reads "Willemstad | v1.11.1 Newfoundland". The codename is part of
  // the user-facing identity and of the licence header; losing it is a silent
  // regression in the meta/ partials.
  const codename = 'Newfoundland';
  assert.ok(text.includes(codename), `theme.css no longer mentions the release codename "${codename}"`);
  assert.ok(
    text.includes(`v${manifest.version} ${codename}`),
    `expected the banner "v${manifest.version} ${codename}" — the codename and version drifted apart`,
  );
});

test('the licence banner is intact', () => {
  // GPL-3.0 requires the notice to travel with the distributed file.
  assert.ok(text.includes('GNU General Public License version 3.0'), 'the GPL banner is missing from theme.css');
  assert.ok(text.includes('Melvin Ting'), 'the upstream copyright notice is missing from theme.css');
  assert.ok(/Copyright\s+2022-2025/.test(text), 'the copyright years line is missing from theme.css');
});
