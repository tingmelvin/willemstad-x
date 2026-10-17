/**
 * tests/syntax.test.mjs — "is theme.css valid CSS, and is it valid *Obsidian*
 * CSS?"
 *
 * This is the cheapest possible guard against a broken build: a single
 * unbalanced brace in a 5 MB file silently swallows every rule after it, and
 * Obsidian does not report it — the theme just renders wrong.
 *
 * Obsidian-specific invariants live here too:
 *   - no @import (Obsidian loads one theme file; @import is not supported and
 *     silently does nothing, so a refactor that "helpfully" splits the theme
 *     with @import would appear to work and change nothing)
 *   - UTF-8 without BOM (a BOM before @charset makes the stylesheet invalid)
 *   - CRLF everywhere (the file is committed with CRLF; mixed endings break the
 *     byte-for-byte baseline)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { themeBytes, themeRoot, themeText } from './helpers/css.mjs';

test('theme.css parses as CSS with zero syntax errors', () => {
  // postcss.parse throws on the first error; reaching here means the file is
  // structurally valid. Report the error verbatim if it ever throws.
  assert.doesNotThrow(() => {
    const root = themeRoot();
    assert.ok(root.nodes.length > 1000, `only ${root.nodes.length} top-level nodes — file truncated?`);
  });
});

test('braces are balanced (and the file does not end mid-rule)', () => {
  const text = themeText();
  // Count only outside comments and strings: a stray `{` in prose is common in
  // this theme (the license banner and the documentation comments).
  let depth = 0;
  let min = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
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
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth < min) min = depth;
    }
    i++;
  }
  assert.equal(min, 0, `a closing brace appears before its opening brace (depth went to ${min})`);
  assert.equal(depth, 0, `unbalanced braces: file ends at depth ${depth} (${depth > 0 ? 'missing }' : 'extra }'})`);
});

test('comments are balanced (no unterminated /* swallows the rest of the file)', () => {
  const text = themeText();
  // Walk the file exactly as a CSS tokenizer would: `/*` opens, `*/` closes, and
  // strings inside declarations must not be mistaken for comment delimiters.
  let i = 0;
  let openAt = -1;
  const n = text.length;
  let unterminated = 0;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      openAt = i;
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        unterminated++;
        i = n;
      } else {
        i = end + 2;
      }
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
  assert.equal(unterminated, 0, `unterminated comment starting at byte ${openAt} — everything after it is invisible`);
  // Note: a raw count of `/*` vs `*/` is NOT a valid check — prose inside comments
  // legitimately contains `/*` (this theme documents regexes and paths). The
  // tokenizer walk above is the authoritative balance check.
});

test('theme.css contains no @import (Obsidian does not support it)', () => {
  const root = themeRoot();
  const imports = [];
  root.walkAtRules('import', (at) => imports.push(at.params));
  assert.deepEqual(
    imports,
    [],
    'theme.css must be a single self-contained stylesheet. Obsidian does not resolve @import,\n' +
      'so any imported file would silently never load. Use src/ partials + scripts/build.mjs instead.',
  );
});

test('theme.css has no BOM and starts with @charset', () => {
  const bytes = themeBytes();
  assert.notDeepEqual(
    [...bytes.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    'theme.css starts with a UTF-8 BOM. A BOM before @charset makes the stylesheet invalid.',
  );
  assert.ok(
    bytes.toString('utf8', 0, 20).startsWith('@charset "UTF-8";'),
    `theme.css should start with @charset "UTF-8"; (got ${JSON.stringify(bytes.toString('utf8', 0, 20))})`,
  );
});

test('theme.css is UTF-8 and contains no replacement characters', () => {
  const bytes = themeBytes();
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); // throws on invalid UTF-8
  assert.ok(decoded.length > 0);
  const bad = decoded.indexOf('\uFFFD');
  assert.equal(bad, -1, `U+FFFD replacement character found at char offset ~${bad} — file was saved with the wrong encoding`);
});

test('theme.css uses CRLF line endings consistently', () => {
  const text = themeText();
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  assert.equal(lf, 0, `${lf} bare LF line ending(s) found — the build emits CRLF only (see build.mjs OUTPUT_EOL)`);
  assert.equal(cr, 0, `${cr} bare CR line ending(s) found`);
  assert.ok(crlf > 50_000, `expected >50k CRLF lines, found ${crlf}`);
});

test('no stray directive markers survive the build', () => {
  const text = themeText();
  // The build rewrites these. If one reaches the output, an @include/@font/@svg/
  // @raw path was mistyped and the directive was passed through as a comment —
  // which means a chunk of CSS or an asset is silently missing.
  const leftovers = [...text.matchAll(/\/\*@(include|font|svg|raw|manifest)\b/g)].map((m) => m[0]);
  assert.deepEqual(
    leftovers,
    [],
    `${leftovers.length} unexpanded build directive(s) leaked into theme.css: ${[...new Set(leftovers)].join(', ')}`,
  );
});

test('@charset appears exactly once, as the first node', () => {
  const root = themeRoot();
  const charsets = [];
  root.walkAtRules('charset', (at) => charsets.push(at.params));
  assert.equal(charsets.length, 1, `@charset appears ${charsets.length} times — it must appear exactly once`);
  assert.equal(root.first.type, 'atrule', 'the first node must be @charset');
  assert.equal(root.first.name, 'charset', `first node is @${root.first.name}, expected @charset`);
});

test('the file ends outside any comment or rule', () => {
  // A regression mode for the split refactor: if a partial ends with `/*` and the
  // next begins with a rule, everything between is swallowed. The postcss AST
  // already proves the structure, so this asserts the raw tail is well-formed.
  const text = themeText();
  const tail = text.trimEnd();
  assert.ok(tail.length > 0, 'theme.css is empty');
  const lastOpen = tail.lastIndexOf('/*');
  const lastClose = tail.lastIndexOf('*/');
  assert.ok(
    lastClose > lastOpen,
    `theme.css ends inside a comment (last /* at ${lastOpen}, last */ at ${lastClose})`,
  );
});
