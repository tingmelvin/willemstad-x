#!/usr/bin/env node
/**
 * bump-version.mjs — update every place a release version lives, consistently.
 *
 * Three files carry version state:
 *   manifest.json  "version" / "minAppVersion"
 *   versions.json  "<version>": "<minAppVersion>"     (compatibility map)
 *   theme.css      the rendered version string         (generated — rebuilt here)
 *
 * The stylesheet's version text is *derived*: it comes from the `$version` token
 * baked into the source partial, so this script rewrites the source, not the
 * artifact, then rebuilds. That keeps `build --check` green by construction.
 *
 * Usage:
 *   node scripts/bump-version.mjs 1.12.0                  bump, keep minAppVersion
 *   node scripts/bump-version.mjs 1.12.0 --min-app 1.13.0 bump and raise floor
 *   node scripts/bump-version.mjs --dry-run 1.12.0        show what would change
 *
 * Exit codes: 0 ok, 1 refused (invalid semver, would go backwards), 2 bad usage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SEMVER = /^\d+\.\d+\.\d+$/;

// The compiled stylesheet prints the version in several places (titlebar suffix,
// community-theme modal, the banner comment), all authored in the meta partials.
// This is where that string lives; it is rewritten here and then rebuilt.
const VERSION_SOURCE_DIR = 'src/meta';

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error('usage: node scripts/bump-version.mjs <x.y.z> [--min-app <x.y.z>] [--dry-run]');
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { version: null, minApp: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--min-app') opts.minApp = argv[++i];
    else if (a === '--help' || a === '-h') usage();
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (opts.version) usage(`unexpected argument ${a}`);
    else opts.version = a;
  }
  if (!opts.version) usage('missing version');
  if (!SEMVER.test(opts.version)) usage(`"${opts.version}" is not x.y.z`);
  if (opts.minApp && !SEMVER.test(opts.minApp)) usage(`"${opts.minApp}" is not x.y.z`);
  return opts;
}

const semverParts = (v) => v.split('.').map((n) => Number.parseInt(n, 10));
const isNewer = (a, b) => {
  const [a1, a2, a3] = semverParts(a);
  const [b1, b2, b3] = semverParts(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
};

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(ROOT, 'manifest.json');
  const versionsPath = path.join(ROOT, 'versions.json');

  const manifest = readJson('manifest.json');
  const versions = readJson('versions.json');

  const current = manifest.version;
  if (current === opts.version) usage(`version is already ${opts.version}`);
  if (isNewer(opts.version, current) <= 0) {
    usage(`new version ${opts.version} must be greater than current ${current}`);
  }

  const minApp = opts.minApp ?? manifest.minAppVersion;
  if (!minApp) usage('manifest.json has no minAppVersion and --min-app was not given');

  const changes = [];

  // --- manifest.json ------------------------------------------------------
  if (manifest.version !== opts.version || manifest.minAppVersion !== minApp) {
    manifest.version = opts.version;
    manifest.minAppVersion = minApp;
    changes.push({
      file: 'manifest.json',
      write: () => fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      detail: `version ${current} -> ${opts.version}, minAppVersion -> ${minApp}`,
    });
  }

  // --- versions.json ------------------------------------------------------
  // The map is keyed by release; adding the entry is what makes Obsidian offer
  // the update at all.
  if (!Object.hasOwn(versions, opts.version) || versions[opts.version] !== minApp) {
    versions[opts.version] = minApp;
    // Preserve the file's existing 4-space style and key order (it is already
    // chronological, so appending keeps it readable).
    const ordered = {};
    for (const k of Object.keys(versions).sort(isNewer)) ordered[k] = versions[k];
    changes.push({
      file: 'versions.json',
      write: () => fs.writeFileSync(versionsPath, JSON.stringify(ordered, null, 4), 'utf8'),
      detail: `add "${opts.version}": "${minApp}"`,
    });
  }

  // --- stylesheet source --------------------------------------------------
  // Scan every meta partial for the *current* version token and rewrite it.
  // Historical versions mentioned in changelog-style comments are left alone.
  const metaDir = path.join(ROOT, VERSION_SOURCE_DIR);
  if (fs.existsSync(metaDir)) {
    const touched = [];
    for (const entry of fs.readdirSync(metaDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.css')) continue;
      const abs = path.join(metaDir, entry.name);
      const src = fs.readFileSync(abs, 'utf8');
      if (!src.includes(`v${current}`)) continue;
      const next = src.split(`v${current}`).join(`v${opts.version}`);
      if (next === src) continue;
      const count = (src.match(new RegExp(`v${current.replace(/\./g, '\\.')}`, 'g')) ?? []).length;
      touched.push({ abs, next, count, rel: `${VERSION_SOURCE_DIR}/${entry.name}` });
    }

    if (touched.length) {
      for (const t of touched) {
        changes.push({
          file: t.rel,
          write: () => fs.writeFileSync(t.abs, t.next, 'utf8'),
          detail: `${t.count} occurrence(s) of v${current} -> v${opts.version}`,
        });
      }
    } else {
      console.warn(
        `warning: no file under ${VERSION_SOURCE_DIR}/ mentions v${current}; ` +
          'the version string may live elsewhere — check the diff after building.',
      );
    }
  } else {
    console.warn(`warning: ${VERSION_SOURCE_DIR}/ not found; skipping stylesheet version string`);
  }

  if (!changes.length) {
    console.log('nothing to change');
    return;
  }

  for (const c of changes) {
    if (opts.dryRun) console.log(`would update ${c.file}: ${c.detail}`);
    else {
      c.write();
      console.log(`updated ${c.file}: ${c.detail}`);
    }
  }

  if (opts.dryRun) {
    console.log('\n(dry run — no files written, no rebuild)');
    return;
  }

  // --- rebuild ------------------------------------------------------------
  // theme.css is generated; bumping the source without rebuilding would leave the
  // shipped artifact advertising the old version.
  const build = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    console.error('\nbuild failed — fix the source, then rerun the build');
    process.exit(1);
  }

  const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-version.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (check.status !== 0) {
    console.error('\nversion check failed after bump — inspect the output above');
    process.exit(1);
  }

  console.log(`\nbumped to ${opts.version} (Obsidian >= ${minApp}). Review the diff before committing.`);
}

main();
