#!/usr/bin/env node
/**
 * check-version.mjs — keep the three places a version number lives in sync.
 *
 * A version number appears in:
 *   1. manifest.json      "version"          (what Obsidian reads to offer updates)
 *   2. versions.json      "<version>": "<minAppVersion>"   (the compatibility map)
 *   3. theme.css          the rendered version string in the titlebar / theme modal
 *
 * They drift apart easily, and a mismatch is user-visible: Obsidian will either
 * never offer the update, or offer it to people whose app is too old. This script
 * is the guard. It runs in CI and via `pnpm run check:version`.
 *
 * Usage:
 *   node scripts/check-version.mjs            verify consistency
 *   node scripts/check-version.mjs --json     machine-readable result
 *
 * Exit codes: 0 consistent, 1 inconsistent, 2 bad invocation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

function main() {
  const asJson = process.argv.includes('--json');
  const unknown = process.argv.slice(2).filter((a) => a !== '--json');
  if (unknown.length) {
    console.error(`unknown argument(s): ${unknown.join(' ')}`);
    console.error('usage: node scripts/check-version.mjs [--json]');
    process.exit(2);
  }

  const errors = [];
  const notes = [];

  // --- manifest -----------------------------------------------------------
  let manifest;
  try {
    manifest = readJson('manifest.json');
  } catch (err) {
    console.error(`cannot read manifest.json: ${err.message}`);
    process.exit(1);
  }

  for (const field of ['name', 'version', 'minAppVersion', 'author']) {
    if (!manifest[field]) errors.push(`manifest.json: missing required field "${field}"`);
  }

  const version = manifest.version;
  const minAppVersion = manifest.minAppVersion;
  if (!version) {
    errors.push('manifest.json: "version" is empty — cannot continue');
    return report({ errors, notes, asJson });
  }

  // --- versions.json ------------------------------------------------------
  let versions;
  try {
    versions = readJson('versions.json');
  } catch (err) {
    errors.push(`cannot read versions.json: ${err.message}`);
    return report({ errors, notes, asJson });
  }

  if (!Object.hasOwn(versions, version)) {
    errors.push(
      `versions.json: missing key "${version}" — Obsidian will not offer this release. ` +
        `Add "${version}": "${minAppVersion}".`,
    );
  } else if (versions[version] !== minAppVersion) {
    errors.push(
      `versions.json["${version}"] is "${versions[version]}" but manifest.json minAppVersion is ` +
        `"${minAppVersion}" — they must match.`,
    );
  }

  // The current release should be the highest version in the map, otherwise a
  // stale entry was left behind or the manifest was rolled back.
  const semver = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const cmp = (a, b) => {
    const [x, y, z] = semver(a);
    const [p, q, r] = semver(b);
    return x - p || y - q || z - r;
  };
  const highest = Object.keys(versions).sort(cmp).at(-1);
  if (highest && cmp(version, highest) < 0) {
    errors.push(
      `manifest.json version "${version}" is older than versions.json's newest entry "${highest}". ` +
        'Was the manifest rolled back without updating versions.json?',
    );
  }

  // --- theme.css ----------------------------------------------------------
  const cssPath = path.join(ROOT, 'theme.css');
  if (!fs.existsSync(cssPath)) {
    errors.push('theme.css not found — run `node scripts/build.mjs`');
    return report({ errors, notes, asJson });
  }

  const css = fs.readFileSync(cssPath, 'utf8');

  // The compiled stylesheet prints its own version in two places: the titlebar
  // suffix and the community-theme modal. Both are generated from one source
  // string, so a single occurrence of the version is the invariant we need.
  const occurrences = (css.match(new RegExp(`v${version.replace(/\./g, '\\.')}\\b`, 'g')) ?? []).length;
  if (occurrences === 0) {
    errors.push(
      `theme.css does not mention version "v${version}" — rebuild after bumping manifest.json ` +
        '(`node scripts/build.mjs`).',
    );
  } else {
    notes.push(`theme.css mentions v${version} ${occurrences}x`);
  }

  // A stale version string is a reliable symptom of "bumped the manifest, forgot
  // to rebuild" — worth surfacing even though it is not strictly an error.
  const allMentioned = [...new Set((css.match(/v\d+\.\d+\.\d+/g) ?? []))];
  const stale = allMentioned.filter((v) => v !== `v${version}`);
  if (stale.length) {
    notes.push(`theme.css also mentions other versions: ${stale.join(', ')} (expected if historical)`);
  }

  report({ errors, notes, asJson, version, minAppVersion });
}

function report({ errors, notes, asJson, version, minAppVersion }) {
  if (asJson) {
    console.log(JSON.stringify({ ok: errors.length === 0, version, minAppVersion, errors, notes }, null, 2));
  } else {
    for (const n of notes) console.log(`note: ${n}`);
    for (const e of errors) console.error(`error: ${e}`);
    console.log(errors.length ? '\nversion check FAILED' : `version check passed (v${version}, Obsidian >= ${minAppVersion})`);
  }
  process.exit(errors.length ? 1 : 0);
}

main();
