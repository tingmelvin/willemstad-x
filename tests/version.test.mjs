/**
 * tests/version.test.mjs — scripts/check-version.mjs, including its known failure.
 *
 * `check-version.mjs` cross-checks the three places a version lives (manifest.json,
 * versions.json, the rendered theme.css string) and exits 1 when they disagree.
 *
 * It currently exits 1 — and that is correct. Upstream shipped Willemstad 1.11.1
 * with `versions.json["1.11.1"] = "1.11.0"` while `manifest.json` says
 * `minAppVersion: "1.13.0"`. Obsidian uses that map to decide which app versions
 * get offered the release, so the two disagreeing makes the 1.11.1 rollout
 * undefined for anyone on 1.11.0 – 1.13.0. See docs/KNOWN-ISSUES.md "#1".
 *
 * The tests below therefore assert the *failure* explicitly. When someone fixes
 * the data, `test('KNOWN-ISSUE: …')` goes red on purpose and must be updated —
 * that is how a pinned defect stays visible instead of rotting into a skipped
 * test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ROOT, MANIFEST_PATH, VERSIONS_PATH } from './helpers/css.mjs';

const runCheckVersion = (args = ['--json']) =>
  spawnSync(process.execPath, ['scripts/check-version.mjs', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });

const parseJson = (r) => {
  try {
    return JSON.parse(r.stdout);
  } catch {
    assert.fail(`check-version.mjs --json did not emit JSON.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
};

// ---------------------------------------------------------------------------
// contract of the script itself
// ---------------------------------------------------------------------------

test('check-version.mjs --json emits a structured result', () => {
  const r = runCheckVersion();
  const result = parseJson(r);
  assert.equal(typeof result, 'object', 'expected a JSON object');
  assert.equal(typeof result.ok, 'boolean', 'result.ok must be a boolean');
  assert.ok(Array.isArray(result.errors), 'result.errors must be an array');
  assert.ok(Array.isArray(result.notes), 'result.notes must be an array');
  assert.equal(typeof result.version, 'string', 'result.version must be a string');
  assert.equal(typeof result.minAppVersion, 'string', 'result.minAppVersion must be a string');
});

test('check-version.mjs exit code agrees with result.ok', () => {
  const r = runCheckVersion();
  const result = parseJson(r);
  assert.equal(
    r.status,
    result.ok ? 0 : 1,
    `exit code ${r.status} disagrees with ok=${result.ok}. CI relies on the exit code alone.`,
  );
});

test('check-version.mjs rejects unknown arguments with exit 2', () => {
  const r = runCheckVersion(['--nope']);
  assert.equal(r.status, 2, `expected exit 2 for a bad invocation, got ${r.status}`);
});

test('check-version.mjs reports the version it actually read', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const result = parseJson(runCheckVersion());
  assert.equal(result.version, manifest.version);
  assert.equal(result.minAppVersion, manifest.minAppVersion);
});

test('check-version.mjs notes how often theme.css mentions the version', () => {
  const result = parseJson(runCheckVersion());
  const note = result.notes.find((n) => /theme\.css mentions v/.test(n));
  assert.ok(note, `expected a note about theme.css version mentions, got: ${JSON.stringify(result.notes)}`);
  const count = Number(note.match(/v\d+\.\d+\.\d+ (\d+)x/)?.[1] ?? 0);
  assert.ok(count >= 1, `theme.css must print the version at least once (note said: ${note})`);
});

// ---------------------------------------------------------------------------
// the previously-pinned known failure — #1, now fixed
// ---------------------------------------------------------------------------

test('check-version passes on the real files (#1, fixed)', () => {
  // Upstream, versions.json said "1.11.1": "1.11.0" while manifest.json said
  // minAppVersion 1.13.0. Obsidian reads versions.json to decide who may be
  // offered an update, so the mismatch left the compatibility floor undefined for
  // everyone on 1.11.0–1.13.0. The entry was corrected to 1.13.0.
  //
  // This test used to assert the failure existed. It now asserts the files agree,
  // and that they agree on 1.13 — the ruling this fork was fixed against.
  const { status, stdout } = runCheckVersion();
  const result = parseJson({ status, stdout });

  assert.equal(
    result.ok,
    true,
    `check-version.mjs reports the version metadata as inconsistent:\n  ${result.errors.join('\n  ')}`,
  );
  assert.deepEqual(result.errors, [], `expected no errors, got:\n  ${result.errors.join('\n  ')}`);
  assert.equal(status, 0, 'check-version.mjs should exit 0 when the metadata is consistent');

  // The specific values, so a future edit cannot quietly move the floor again.
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const versions = JSON.parse(readFileSync(path.join(ROOT, 'versions.json'), 'utf8'));
  assert.equal(
    versions[manifest.version],
    manifest.minAppVersion,
    `versions.json["${manifest.version}"] must equal manifest.json minAppVersion`,
  );
  assert.equal(manifest.minAppVersion, '1.13.0', 'this fork targets Obsidian 1.13');
});

test('the version metadata has zero consistency errors', () => {
  // Pinned as a count so a *new* inconsistency is as loud as the old one was.
  const result = parseJson(runCheckVersion());
  assert.equal(
    result.errors.length,
    0,
    `expected 0 consistency errors, found ${result.errors.length}:\n  ${result.errors.join('\n  ')}`,
  );
});

// ---------------------------------------------------------------------------
// behaviour on consistent input (sandboxed copy, never the real files)
// ---------------------------------------------------------------------------

/**
 * Run check-version.mjs against a scratch copy of the repo's metadata so the
 * "happy path" can be exercised without editing manifest.json/versions.json.
 * Only the files the script reads are copied; theme.css is stubbed with the
 * version string it needs.
 */
function withScratchRepo(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'willemstad-version-'));
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const versions = JSON.parse(readFileSync(VERSIONS_PATH, 'utf8'));
    cpSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
    const stub = `/* theme banner */\r\n.selector::after { content: "v${manifest.version}"; }\r\n`;
    writeFileSync(path.join(dir, 'theme.css'), stub, 'utf8');
    fn({ dir, manifest, versions, writeJson: (name, obj) => writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2), 'utf8') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const runIn = (dir, args = ['--json']) =>
  spawnSync(process.execPath, ['scripts/check-version.mjs', ...args], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
  });

test('check-version passes when manifest and versions agree', () => {
  withScratchRepo(({ dir, manifest, versions, writeJson }) => {
    const fixed = { ...versions, [manifest.version]: manifest.minAppVersion };
    writeJson('manifest.json', manifest);
    writeJson('versions.json', fixed);
    const r = runIn(dir);
    const result = JSON.parse(r.stdout);
    assert.equal(
      result.ok,
      true,
      `expected a consistent repo to pass, got errors:\n  ${result.errors.join('\n  ')}\n` +
        'This is the assertion that proves the checker is not just always-failing.',
    );
    assert.equal(r.status, 0);
  });
});

test('check-version fails when versions.json is missing the current version', () => {
  withScratchRepo(({ dir, manifest, versions, writeJson }) => {
    const withoutCurrent = { ...versions };
    delete withoutCurrent[manifest.version];
    writeJson('manifest.json', manifest);
    writeJson('versions.json', withoutCurrent);
    const result = JSON.parse(runIn(dir).stdout);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes(`missing key "${manifest.version}"`)),
      `expected a "missing key" error, got:\n  ${result.errors.join('\n  ')}`,
    );
  });
});

test('check-version fails when theme.css advertises an old version', () => {
  withScratchRepo(({ dir, manifest, versions, writeJson }) => {
    const fixed = { ...versions, [manifest.version]: manifest.minAppVersion };
    writeJson('manifest.json', manifest);
    writeJson('versions.json', fixed);
    writeFileSync(path.join(dir, 'theme.css'), '.x::after { content: "v0.0.1"; }\r\n', 'utf8');
    const result = JSON.parse(runIn(dir).stdout);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes('does not mention version')),
      `expected a "does not mention version" error, got:\n  ${result.errors.join('\n  ')}`,
    );
  });
});

test('check-version fails when the manifest is rolled back below versions.json', () => {
  withScratchRepo(({ dir, manifest, versions, writeJson }) => {
    const older = { ...manifest, version: '1.0.0', minAppVersion: '1.0.0' };
    const withEntry = { ...versions, '1.0.0': '1.0.0' };
    writeJson('manifest.json', older);
    writeJson('versions.json', withEntry);
    writeFileSync(path.join(dir, 'theme.css'), '.x::after { content: "v1.0.0"; }\r\n', 'utf8');
    const result = JSON.parse(runIn(dir).stdout);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.includes('older than versions.json')),
      `expected a rollback error, got:\n  ${result.errors.join('\n  ')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// the release token rendered into the theme
// ---------------------------------------------------------------------------

test('--willemstad-release is a quoted string that tracks the manifest', () => {
  // The version the user actually sees is rendered from one custom property, so
  // this is the fourth place the version lives (after manifest.json,
  // versions.json and the licence banner) and the only one whose *type* matters.
  //
  // It is substituted into `content`, which accepts <content-list> only. An
  // unquoted `v1.11.1 Newfoundland` substitutes to a run of idents and numbers,
  // making the declaration invalid at computed-value time — the version text
  // then disappears from both the title bar and the community card, silently.
  // Quoted, the substitution yields two adjacent strings, which concatenate.
  const text = readFileSync(path.join(ROOT, 'theme.css'), 'utf8');
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

  const raw = /--willemstad-release:\s*([^;]+);/.exec(text)?.[1]?.trim();
  assert.ok(raw, 'theme.css must declare --willemstad-release');

  assert.ok(
    raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'),
    `--willemstad-release must be a double-quoted string, got ${JSON.stringify(raw)}.\n` +
      'Unquoted, every consumer becomes an invalid `content` value and the version\n' +
      'text silently renders as nothing.',
  );
  assert.ok(
    raw.slice(1, -1).startsWith(`v${manifest.version}`),
    `--willemstad-release ${JSON.stringify(raw)} must start with v${manifest.version}`,
  );

  // Both consumers must go through the token, or the two can drift apart.
  for (const selector of ['div\\.titlebar-text::after', '\\.community-item\\.mod-active \\.community-item-name::after']) {
    const block = new RegExp(`${selector}\\s*\\{[^}]*\\}`).exec(text)?.[0];
    assert.ok(block, `expected a rule for ${selector.replace(/\\\\/g, '')}`);
    assert.match(block, /var\(--willemstad-release\)/, `${selector} must use the release token`);
  }
});
