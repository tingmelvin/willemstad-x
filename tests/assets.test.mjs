/**
 * tests/assets.test.mjs — the embedded binaries are intact.
 *
 * theme.css inlines 17 fonts (~3 MB) and 52 SVG icon references as base64 data
 * URIs. That makes the shipped file self-contained (Obsidian themes cannot load
 * sibling files) and makes it trivially breakable: a truncated base64 string, a
 * re-encoded payload, or a wrong asset path produces a theme that loads but has
 * no icons and no typography — with no error message anywhere.
 *
 * What is checked:
 *   1. every payload base64-decodes
 *   2. every font payload has a recognisable font magic number
 *   3. every SVG payload decodes to something that starts with <svg
 *   4. the compiled payloads are byte-identical to the files in src/assets/
 *   5. the counts line up with what the build claims to have inlined
 *
 * Note on (2): the `data:font/woff2` label is a *label*, not a guarantee. Five of
 * the seventeen payloads are raw TrueType (`00 01 00 00`), not WOFF2 (`wOF2`) —
 * see KNOWN-ISSUES #8. Browsers sniff the sfnt version and load them
 * anyway, so this is pinned rather than failed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { ROOT, FONT_FILES_DIR, ICON_FILES_DIR, SRC_DIR, themeText, themeRoot, rel } from './helpers/css.mjs';

/**
 * Match any font container, not just `font/woff2`.
 *
 * The theme embeds both `font/woff2` and `font/ttf`: five upstream payloads were
 * bare TrueType mislabelled as woff2, and correcting that label (KNOWN-ISSUES #8)
 * split them across two MIME types. A `woff2`-only pattern here silently stops
 * seeing those five and every count below goes wrong.
 */
const FONT_URI_RE = /data:(font\/[a-z0-9.+-]+);charset=utf-8;base64,([A-Za-z0-9+/=]+)/g;
const SVG_B64_RE = /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g;

/** Font containers the theme may embed, keyed by extension. */
const FONT_FILE_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf', '.ttc']);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Counts pinned against the fork's post-fix baseline. If the build starts inlining
 * a different number of assets, that is a real change in the shipped file and
 * should be reviewed.
 */
const EXPECTED_FONT_PAYLOADS = 17;
const EXPECTED_SVG_REFERENCES = 52;
const EXPECTED_UNIQUE_SVG_PAYLOADS = 27;
/**
 * Of the 17 font payloads, 12 are WOFF2 and 5 are bare TrueType.
 *
 * This split is *correct* now: the five TrueType faces declare `font/ttf` and
 * `format("truetype-variations")` instead of claiming to be woff2. Upstream they
 * were all labelled woff2 while five of them were not — see KNOWN-ISSUES #8.
 */
const EXPECTED_WOFF2 = 12;
const EXPECTED_TRUETYPE = 5;

const text = themeText();
const fontMatches = [...text.matchAll(FONT_URI_RE)].map((m) => ({ mime: m[1], b64: m[2] }));
const fontPayloads = fontMatches.map((f) => f.b64);
const svgPayloads = [...text.matchAll(SVG_B64_RE)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// decoding
// ---------------------------------------------------------------------------

test('every embedded payload is valid base64', () => {
  const bad = [];
  for (const [kind, list] of [
    ['font', fontPayloads],
    ['svg', svgPayloads],
  ]) {
    for (const [i, b64] of list.entries()) {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) bad.push(`${kind}[${i}]: invalid base64 alphabet`);
      else if (b64.length % 4 !== 0) bad.push(`${kind}[${i}]: length ${b64.length} is not a multiple of 4 (truncated?)`);
      else if (Buffer.from(b64, 'base64').length === 0) bad.push(`${kind}[${i}]: decodes to zero bytes`);
    }
  }
  assert.deepEqual(bad, [], `corrupt base64 payloads:\n  ${bad.join('\n  ')}`);
});

test('base64 payloads survive a decode/encode round trip', () => {
  // A payload that does not round-trip means the encoder emitted something that
  // decodes differently (stray whitespace, wrong padding) — the browser may or
  // may not be as forgiving.
  const bad = [];
  for (const [kind, list] of [
    ['font', fontPayloads],
    ['svg', svgPayloads],
  ]) {
    for (const [i, b64] of list.entries()) {
      const reencoded = Buffer.from(b64, 'base64').toString('base64');
      if (reencoded !== b64) bad.push(`${kind}[${i}]`);
    }
  }
  assert.deepEqual(bad, [], `payloads that do not round-trip: ${bad.join(', ')}`);
});

// ---------------------------------------------------------------------------
// font magic numbers
// ---------------------------------------------------------------------------

test('every font payload has a recognisable font signature', () => {
  const known = {
    '774f4632': 'wOF2', // WOFF2
    '774f4631': 'wOFF', // WOFF
    '00010000': 'TrueType', // raw sfnt, TrueType outlines
    '4f54544f': 'OTTO', // raw sfnt, CFF outlines
    '74746366': 'ttcf', // TrueType collection
  };
  const bad = [];
  const histogram = new Map();
  for (const [i, b64] of fontPayloads.entries()) {
    const buf = Buffer.from(b64, 'base64');
    const magic = buf.subarray(0, 4).toString('hex');
    histogram.set(magic, (histogram.get(magic) ?? 0) + 1);
    if (!(magic in known)) {
      bad.push(`font[${i}]: magic ${magic} (${JSON.stringify(buf.subarray(0, 4).toString('latin1'))}) is not a font format`);
    }
    if (buf.length < 1000) bad.push(`font[${i}]: only ${buf.length} bytes — truncated payload`);
  }
  assert.deepEqual(bad, [], `font payloads that are not fonts:\n  ${bad.join('\n  ')}`);
});

test('every font MIME label matches the container it actually holds (#8, fixed)', () => {
  // Upstream declared all 17 fonts `font/woff2` with a woff2 `format()` hint, but
  // five were bare sfnt (`00 01 00 00`). Chromium sniffs the container and loaded
  // them anyway, so the lie was invisible — and therefore permanent.
  //
  // The fix derives both the file extension and the MIME type from the magic
  // bytes. This test asserts the result: no payload may declare a container it
  // does not hold. It replaces the old pin that asserted the mislabelling existed.
  const MAGIC_TO_MIME = {
    '774f4632': 'font/woff2', // wOF2
    '774f4646': 'font/woff', // wOFF
    '00010000': 'font/ttf', // raw sfnt, TrueType outlines
    '4f54544f': 'font/otf', // OTTO, CFF outlines
    '74746366': 'font/collection', // ttcf
  };

  const mismatches = [];
  let woff2 = 0;
  let truetype = 0;
  for (const [i, f] of fontMatches.entries()) {
    const magic = Buffer.from(f.b64, 'base64').subarray(0, 4).toString('hex');
    const actual = MAGIC_TO_MIME[magic];
    if (magic === '774f4632') woff2++;
    if (magic === '00010000') truetype++;
    if (actual === undefined) {
      mismatches.push(`font[${i}]: unrecognised container magic ${magic}`);
      continue;
    }
    if (actual !== f.mime) {
      mismatches.push(`font[${i}]: declares ${f.mime} but the bytes are ${actual} (${magic})`);
    }
  }

  assert.deepEqual(
    mismatches,
    [],
    `font payloads whose MIME label lies about the container:\n  ${mismatches.join('\n  ')}`,
  );
  assert.equal(woff2, EXPECTED_WOFF2, `expected ${EXPECTED_WOFF2} WOFF2 payloads, found ${woff2}`);
  assert.equal(truetype, EXPECTED_TRUETYPE, `expected ${EXPECTED_TRUETYPE} TrueType payloads, found ${truetype}`);
});

test('every @font-face format() hint agrees with the container it declares', () => {
  // The MIME test above covers the `data:` label. This covers the *other* half of
  // the same claim: the `format()` keyword in the src descriptor.
  //
  // It is a separate test because the two can drift apart independently, and
  // because the keywords are not extensions — `.ttf` is `truetype`, `.otf` is
  // `opentype`, `.ttc` is `collection`. A checker that compares a hint against a
  // file extension reports a false mismatch for every TrueType face, which is
  // precisely how the original mislabelling (KNOWN-ISSUES #8) stayed buried.
  const MAGIC_TO_KEYWORDS = {
    '774f4632': ['woff2'], // wOF2
    '774f4646': ['woff'], // wOFF
    '00010000': ['truetype'], // raw sfnt with TrueType outlines
    '4f54544f': ['opentype'], // OTTO, CFF outlines
    '74746366': ['collection'], // ttcf
  };

  const problems = [];
  let checked = 0;
  themeRoot().walkAtRules('font-face', (at) => {
    const decls = new Map();
    at.walkDecls((d) => decls.set(d.prop, d.value));
    const family = decls.get('font-family') ?? '(unnamed)';
    const src = decls.get('src') ?? '';

    const b64 = /base64,([A-Za-z0-9+/=]+)/.exec(src)?.[1];
    const hint = /format\(\s*"([^"]+)"\s*\)/.exec(src)?.[1];
    if (!b64) {
      problems.push(`${family}: src has no base64 payload`);
      return;
    }
    if (!hint) {
      problems.push(`${family}: src has no format() hint`);
      return;
    }

    const magic = Buffer.from(b64, 'base64').subarray(0, 4).toString('hex');
    const keywords = MAGIC_TO_KEYWORDS[magic];
    if (!keywords) {
      problems.push(`${family}: unrecognised container magic ${magic}`);
      return;
    }

    checked++;
    // `woff` must not satisfy `woff2`, so require the exact keyword or a
    // `-variations` / `-<feature>` suffix.
    const ok = keywords.some((k) => hint === k || hint.startsWith(`${k}-`));
    if (!ok) {
      problems.push(
        `${family}: format("${hint}") does not describe the ${keywords[0]} container (magic ${magic})`,
      );
    }
  });

  assert.equal(checked, EXPECTED_FONT_PAYLOADS, `checked ${checked} @font-face blocks, expected ${EXPECTED_FONT_PAYLOADS}`);
  assert.deepEqual(
    problems,
    [],
    `@font-face descriptors that misdescribe their own payload:\n  ${problems.join('\n  ')}\n` +
      'A browser is entitled to trust this hint and skip the face.',
  );
});

test('@font-face blocks are well-formed', () => {
  const root = themeRoot();
  const faces = [];
  root.walkAtRules('font-face', (at) => {
    const decls = new Map();
    at.walkDecls((d) => decls.set(d.prop, d.value));
    faces.push(decls);
  });
  assert.equal(faces.length, EXPECTED_FONT_PAYLOADS, `expected ${EXPECTED_FONT_PAYLOADS} @font-face blocks, found ${faces.length}`);

  const bad = [];
  for (const [i, d] of faces.entries()) {
    if (!d.get('font-family')) bad.push(`@font-face[${i}]: no font-family`);
    const src = d.get('src') ?? '';
    if (!src.includes('data:font/')) bad.push(`@font-face[${i}] (${d.get('font-family')}): src is not a data: URI`);
    if (!src.includes('format(')) bad.push(`@font-face[${i}] (${d.get('font-family')}): src has no format() hint`);
  }
  assert.deepEqual(bad, [], `malformed @font-face blocks:\n  ${bad.join('\n  ')}`);
});

// ---------------------------------------------------------------------------
// svg payloads
// ---------------------------------------------------------------------------

test('every SVG payload decodes to an <svg> document', () => {
  const bad = [];
  for (const [i, b64] of svgPayloads.entries()) {
    const buf = Buffer.from(b64, 'base64');
    const doc = buf.toString('utf8');
    if (!/^\s*<svg[\s>]/i.test(doc)) {
      bad.push(`svg[${i}]: starts with ${JSON.stringify(doc.slice(0, 40))}`);
      continue;
    }
    if (!/<\/svg>\s*$/i.test(doc)) bad.push(`svg[${i}]: does not close with </svg> (${buf.length} bytes)`);
  }
  assert.deepEqual(bad, [], `malformed SVG payloads:\n  ${bad.join('\n  ')}`);
});

test('the SVG payload count matches the theme reference count', () => {
  assert.equal(
    svgPayloads.length,
    EXPECTED_SVG_REFERENCES,
    `expected ${EXPECTED_SVG_REFERENCES} base64 SVG data URIs in theme.css, found ${svgPayloads.length}`,
  );
  const unique = new Set(svgPayloads);
  assert.equal(
    unique.size,
    EXPECTED_UNIQUE_SVG_PAYLOADS,
    `expected ${EXPECTED_UNIQUE_SVG_PAYLOADS} distinct SVG payloads, found ${unique.size}. ` +
      'Several icons are referenced from more than one rule; if this changed, the icon set changed.',
  );
});

// ---------------------------------------------------------------------------
// src/assets ↔ compiled payloads
// ---------------------------------------------------------------------------

test('every compiled font payload matches a file in src/assets/fonts', (t) => {
  if (!existsSync(FONT_FILES_DIR)) {
    t.skip('src/assets/fonts/ does not exist yet');
    return;
  }
  // Match by content hash, so the container extension is irrelevant — the five
  // TrueType faces are .ttf and must still pair with their payloads.
  const files = readdirSync(FONT_FILES_DIR).filter((f) => FONT_FILE_EXTENSIONS.has(path.extname(f).toLowerCase()));
  const byHash = new Map(files.map((f) => [sha256(readFileSync(path.join(FONT_FILES_DIR, f))), f]));
  const payloadHashes = new Set(fontPayloads.map((b64) => sha256(Buffer.from(b64, 'base64'))));

  const orphanPayloads = [...payloadHashes].filter((h) => !byHash.has(h));
  const unusedFiles = [...byHash.entries()].filter(([h]) => !payloadHashes.has(h));

  assert.deepEqual(
    orphanPayloads,
    [],
    `${orphanPayloads.length} embedded font payload(s) have no corresponding file in src/assets/fonts/.\n` +
      'The build must inline exactly the files that exist; a mismatch means an asset was\n' +
      'renamed or a stale payload is still embedded.',
  );
  assert.deepEqual(
    unusedFiles.map(([, f]) => f),
    [],
    `font files that are never embedded (dead assets): ${unusedFiles.map(([, f]) => f).join(', ')}`,
  );
  assert.equal(files.length, EXPECTED_FONT_PAYLOADS, `expected ${EXPECTED_FONT_PAYLOADS} font files, found ${files.length}`);
});

test('every compiled SVG payload matches a file in src/assets/icons', (t) => {
  if (!existsSync(ICON_FILES_DIR)) {
    t.skip('src/assets/icons/ does not exist yet');
    return;
  }
  const files = readdirSync(ICON_FILES_DIR).filter((f) => f.endsWith('.svg'));
  const byHash = new Map(files.map((f) => [sha256(readFileSync(path.join(ICON_FILES_DIR, f))), f]));
  const payloadHashes = new Set(svgPayloads.map((b64) => sha256(Buffer.from(b64, 'base64'))));

  const orphans = [...payloadHashes].filter((h) => !byHash.has(h));
  const unused = [...byHash.entries()].filter(([h]) => !payloadHashes.has(h)).map(([, f]) => f);

  assert.deepEqual(orphans, [], `${orphans.length} embedded SVG payload(s) have no file in src/assets/icons/`);
  assert.deepEqual(unused, [], `icon files that are never embedded (dead assets): ${unused.join(', ')}`);
  assert.equal(
    files.length,
    EXPECTED_UNIQUE_SVG_PAYLOADS,
    `expected ${EXPECTED_UNIQUE_SVG_PAYLOADS} icon files, found ${files.length}`,
  );
});

test('@font directives in src/ point at files that exist', (t) => {
  if (!existsSync(SRC_DIR)) {
    t.skip('src/ does not exist yet');
    return;
  }
  const missing = [];
  const badExt = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.name.endsWith('.css')) continue;
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/\/\*@(font|svg)[ \t]+([^\s*]+)[ \t]*\*\//g)) {
        const [, kind, target] = m;
        const abs = path.join(SRC_DIR, ...target.split('/'));
        if (!existsSync(abs)) missing.push(`${rel(p)}: @${kind} ${target}`);
        const ext = path.extname(target).toLowerCase();
        if (kind === 'font' && !FONT_FILE_EXTENSIONS.has(ext)) {
          badExt.push(`${rel(p)}: @font expects a font container, got ${target}`);
        }
        if (kind === 'svg' && ext !== '.svg') badExt.push(`${rel(p)}: @svg expects .svg, got ${target}`);
      }
    }
  };
  walk(SRC_DIR);
  assert.deepEqual(missing, [], `asset directives pointing at missing files:\n  ${missing.join('\n  ')}`);
  assert.deepEqual(badExt, [], `asset directives with the wrong extension:\n  ${badExt.join('\n  ')}`);
});
