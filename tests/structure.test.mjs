/**
 * tests/structure.test.mjs — "is every src/ partial independently valid?"
 *
 * The split refactor replaced one 5 MB file with ~137 partials that the build
 * concatenates. Concatenation is forgiving: two files whose comment delimiters
 * only balance *across* the join still produce valid theme.css, while each file
 * on its own is broken. That is exactly the bug this file prevents — it caught
 * one real instance (the GPL banner split across two partials, so `000-aa01.css`
 * opened `/*!` and never closed it).
 *
 * Rules enforced per partial:
 *   1. postcss can parse it standalone
 *   2. comments balance *within the file* (a tokenizer walk, not a raw count)
 *   3. no `@include`-only manifest file is treated as a partial
 *
 * Also pins the include tree against scripts/build.mjs --audit, so a partial
 * that is never included (dead CSS) or included twice (duplicated rules) fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { ROOT, SRC_DIR, SETTINGS_DIR, rel, srcCssFiles, postcss } from './helpers/css.mjs';

const hasSrc = existsSync(SRC_DIR);

/** Walk text the way a CSS tokenizer does; return the first unterminated comment offset. */
function firstUnterminatedComment(text) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return i;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n) {
        if (text[i] === '\\') i += 2;
        else if (text[i] === quote) break;
        else i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

test('every src/ partial parses standalone', (t) => {
  if (!hasSrc) {
    t.skip('src/ does not exist yet');
    return;
  }
  const files = srcCssFiles();
  assert.ok(files.length > 100, `expected >100 partials, found ${files.length}`);

  const broken = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    try {
      postcss.parse(text, { from: file });
    } catch (err) {
      broken.push(`${rel(file)}: ${err.reason} (line ${err.line})`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    `${broken.length} partial(s) are not valid CSS on their own:\n  ${broken.join('\n  ')}\n\n` +
      'A partial must be self-contained. If a comment or a rule deliberately spans two files,\n' +
      'the split is wrong: move the boundary. (This is how the GPL banner was broken.)',
  );
});

test('comments balance within each partial', (t) => {
  if (!hasSrc) {
    t.skip('src/ does not exist yet');
    return;
  }
  const broken = [];
  for (const file of srcCssFiles()) {
    const at = firstUnterminatedComment(readFileSync(file, 'utf8'));
    if (at !== -1) broken.push(`${rel(file)}: unterminated /* at char ${at}`);
  }
  assert.deepEqual(
    broken,
    [],
    `comment delimiters do not balance inside ${broken.length} partial(s):\n  ${broken.join('\n  ')}`,
  );
});

test('every partial is included exactly once (no orphans, no duplicates)', (t) => {
  if (!hasSrc) {
    t.skip('src/ does not exist yet');
    return;
  }
  const r = spawnSync(process.execPath, ['scripts/build.mjs', '--audit'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  const output = `${r.stdout}${r.stderr}`.trim();
  assert.equal(r.status, 0, `build --audit failed:\n${output}`);

  const m = output.match(/audit:\s*(\d+)\s*includes?,\s*(\d+)\s*partials?/i);
  assert.ok(m, `could not parse audit summary from:\n${output}`);
  const [, includes, partials] = m.map(Number);
  assert.equal(
    includes,
    partials,
    `${includes} @include directives but ${partials} partials on disk — an orphan partial would never ship`,
  );

  const onDisk = srcCssFiles().length;
  assert.equal(partials, onDisk, `audit counted ${partials} partials but ${onDisk} .css files exist under src/`);
});

test('the build manifest only contains directives, @charset, and comments', (t) => {
  if (!hasSrc) {
    t.skip('src/ does not exist yet');
    return;
  }
  const entry = path.join(SRC_DIR, 'entries', 'theme.css');
  assert.ok(existsSync(entry), 'src/entries/theme.css is missing');
  const text = readFileSync(entry, 'utf8');
  // Strip every comment (the manifest is comments) and the leading @charset,
  // then assert nothing is left. If real CSS leaks into the manifest it will be
  // emitted before every partial, which silently changes the cascade.
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^@charset\s+"[^"]*";\s*/, '');
  assert.equal(
    withoutComments.trim(),
    '',
    'src/entries/theme.css contains content outside comments. It is a manifest: every line\n' +
      'must be a /* … */ directive, the single leading @charset, or blank. Real CSS belongs in a partial.',
  );
});

test('partial paths in the manifest are POSIX-relative and exist', (t) => {
  if (!hasSrc) {
    t.skip('src/ does not exist yet');
    return;
  }
  const text = readFileSync(path.join(SRC_DIR, 'entries', 'theme.css'), 'utf8');
  const missing = [];
  const backslashed = [];
  for (const m of text.matchAll(/\/\*@(include|font|svg|raw)[ \t]+([^\s*]+)/g)) {
    const [, kind, target] = m;
    if (target.includes('\\')) backslashed.push(`${kind} ${target}`);
    const abs = path.join(SRC_DIR, ...target.split('/'));
    if (!existsSync(abs)) missing.push(`${kind} ${target}`);
  }
  assert.deepEqual(backslashed, [], `Windows-style separators in the manifest: ${backslashed.join(', ')}`);
  assert.deepEqual(missing, [], `manifest references files that do not exist: ${missing.join(', ')}`);
});

test('the Style Settings panel manifest is a manifest, not a stylesheet', (t) => {
  if (!hasSrc) {
    t.skip('src/ does not exist yet');
    return;
  }
  // src/style-settings/126-style-settings.css shares its directory's name and
  // looks like a partial, but it contains no CSS rules: only a banner comment
  // and ten `@raw` directives that inline the YAML panels. It is the panel
  // manifest. (The remaining two panels — cssc-latex and cssc-cornell — are
  // inlined from their own cssclass/ partials, where their styles live.)
  // Asserted here so nobody "fixes" it by adding rules, and so the lint
  // exemption for it has a documented reason.
  const manifest = path.join(SRC_DIR, 'style-settings', '126-style-settings.css');
  assert.ok(existsSync(manifest), 'the Style Settings panel manifest is missing');
  const text = readFileSync(manifest, 'utf8');

  const rawCount = [...text.matchAll(/\/\*@raw[ \t]+([^\s*]+)[ \t]*\*\//g)].map((m) => m[1]);
  assert.equal(rawCount.length, 10, `expected 10 @raw directives here (one per V1 panel), found ${rawCount.length}`);

  // Every panel YAML on disk must be referenced exactly once.
  const yamlFiles = readdirSync(SETTINGS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => `style-settings/${f}`)
    .sort();
  const referenced = [...new Set([...rawCount, ...rawElsewhere()])].sort();
  assert.deepEqual(
    referenced,
    yamlFiles,
    'the set of inlined Style Settings panels does not match the YAML files on disk.\n' +
      'A panel that is not inlined never reaches the user; a reference to a missing file\n' +
      'makes the build fail. Both are reported here first.',
  );

  // And the file must contain no rules of its own.
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(withoutComments.trim(), '', 'the panel manifest must not contain CSS rules');
});

/** `@raw` directives that live outside the panel manifest (two panels are inlined from cssclass/). */
function rawElsewhere() {
  const out = [];
  for (const file of srcCssFiles()) {
    if (path.basename(file) === '126-style-settings.css') continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\/\*@raw[ \t]+([^\s*]+)[ \t]*\*\//g)) out.push(m[1]);
  }
  return out;
}
