/**
 * tests/budget.test.mjs — the file must not grow back.
 *
 * The whole reason this repo was restructured is that theme.css is one 5 MB
 * monolith. Splitting it into src/ makes it maintainable, but it does not make it
 * smaller — and an unguarded stylesheet quietly creeps upward every time someone
 * pastes another base64 asset or another plugin workaround.
 *
 * Budgets are split by *cause*, because the two failure modes are unrelated:
 *
 *   asset weight      — a new embedded font adds 300–500 KB of base64 in one go.
 *                       Tracked at the source (src/assets/fonts/, unencoded), so
 *                       the number is the real font size, not its 4/3 inflation.
 *   CSS weight        — the part humans read and maintain. This is the one that
 *                       should never grow without a reason.
 *   whole artifact    — a loose outer bound; it is dominated by base64 and is
 *                       here only to catch "someone inlined a whole icon set".
 *
 *   total artifact   5.01 MB   limit 6.50 MB  (one font of headroom)
 *   non-base64 CSS   2.05 MB   limit 2.50 MB  (the real guard)
 *   src font files   2.20 MB   limit 3.00 MB  and exactly 17 files (12 .woff2 + 5 .ttf)
 *   single block     160 lines limit 250 lines
 *
 * If a limit fires, ask *why the file got bigger* before raising it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

import { FONT_FILES_DIR, themeBytes, themeText, themeRoot } from './helpers/css.mjs';

const MB = 1024 * 1024;

const TOTAL_LIMIT = 6.5 * MB;
const NON_BASE64_LIMIT = 2.5 * MB;
const FONT_BYTES_LIMIT = 3 * MB;
/** Adding or removing a font is a deliberate, reviewable change — pin the count. */
const EXPECTED_FONT_FILES = 17;
/** Font containers the theme may embed. `.ttf` is real: see docs/KNOWN-ISSUES.md #8. */
const FONT_FILE_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf', '.ttc']);
const MAX_BLOCK_LINES = 250;
const MAX_LINE_LENGTH = 40_000; // a single line longer than this is a data URI, not code

/**
 * Bytes that are inside a `data:` URI payload rather than readable CSS.
 *
 * The font MIME type is matched loosely on purpose. The stylesheet embeds both
 * `font/woff2` and `font/ttf` (five of the upstream payloads are bare TrueType
 * mislabelled as woff2 — see docs/KNOWN-ISSUES.md #8). Hardcoding `font/woff2`
 * here silently stopped stripping those five payloads, which inflated "readable
 * CSS" by ~1.5 MB and made the budget below fire on a change that had actually
 * made the file *smaller*. Match any font container.
 */
const FONT_DATA_RE = /data:font\/[a-z0-9.+-]+;charset=utf-8;base64,([A-Za-z0-9+/=]+)/g;

function base64Bytes(text) {
  let total = 0;
  for (const re of [
    FONT_DATA_RE,
    /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g,
    /data:image\/svg\+xml,([^"')]+)/g,
  ]) {
    for (const m of text.matchAll(re)) total += m[1].length;
  }
  return total;
}

const formatMb = (bytes) => `${(bytes / MB).toFixed(2)} MB`;

test('theme.css stays under the whole-artifact ceiling', () => {
  const size = themeBytes().length;
  assert.ok(
    size < TOTAL_LIMIT,
    `theme.css is ${formatMb(size)}, over the ${formatMb(TOTAL_LIMIT)} budget by ${formatMb(size - TOTAL_LIMIT)}.\n` +
      'Obsidian loads the whole file on every startup. Check what was added: another embedded\n' +
      'font (~300 KB each) or a new plugin workaround block.\n' +
      'Note: this ceiling has ~1.5 MB of headroom on purpose — it is a "did someone inline an\n' +
      'entire icon set" alarm, not the growth guard. The growth guard is the two tests below.',
  );
});

test('the font sources stay under 3 MB (and the file count is pinned)', (t) => {
  if (!existsSync(FONT_FILES_DIR)) {
    t.skip('src/assets/fonts/ does not exist yet');
    return;
  }
  // Any font container, not just .woff2: five of the upstream payloads are bare
  // TrueType and were renamed to .ttf when the mislabelling was corrected.
  const files = readdirSync(FONT_FILES_DIR).filter((f) => FONT_FILE_EXTENSIONS.has(path.extname(f).toLowerCase()));
  const total = files.reduce((n, f) => n + statSync(path.join(FONT_FILES_DIR, f)).size, 0);

  assert.ok(
    total < FONT_BYTES_LIMIT,
    `src/assets/fonts/ is ${formatMb(total)} across ${files.length} files, over the ` +
      `${formatMb(FONT_BYTES_LIMIT)} budget.\n` +
      'Fonts dominate the shipped file: each font becomes ~1.33x its size once base64-encoded.\n' +
      'If a font must be added, remove one first — or subset the existing ones (many of these are\n' +
      'full variable fonts with glyphs the theme never uses).',
  );
  assert.equal(
    files.length,
    EXPECTED_FONT_FILES,
    `${files.length} font files, expected ${EXPECTED_FONT_FILES}. Adding or dropping a font is a\n` +
      'deliberate change: update EXPECTED_FONT_FILES here, the counts in assets.test.mjs, and say\n' +
      'why in the commit message.',
  );

  // Pin the container split too. Five faces are TrueType; if a future change
  // silently re-encodes or renames them, the MIME types in theme.css shift with it.
  const byExt = {};
  for (const f of files) {
    const ext = path.extname(f).slice(1).toLowerCase();
    byExt[ext] = (byExt[ext] ?? 0) + 1;
  }
  assert.deepEqual(
    byExt,
    { woff2: 12, ttf: 5 },
    'the font container split changed. Upstream shipped 12 WOFF2 and 5 bare TrueType faces;\n' +
      'if that changed, update the split here and the MIME assertions in assets.test.mjs.',
  );
});

test('the readable (non-base64) part of theme.css stays under 2.5 MB', () => {
  const text = themeText();
  const total = Buffer.byteLength(text, 'utf8');
  const embedded = base64Bytes(text);
  const readable = total - embedded;
  assert.ok(
    readable < NON_BASE64_LIMIT,
    `the CSS itself is ${formatMb(readable)} (of ${formatMb(total)} total), over the ` +
      `${formatMb(NON_BASE64_LIMIT)} budget.\n` +
      `  embedded data: ${formatMb(embedded)} (${((embedded / total) * 100).toFixed(1)}% of the file)\n` +
      'This is the number that matters for maintainability — it is the part humans read.',
  );
});

test('no single rule block is unreasonably long', () => {
  // Line-span heuristic over the compiled file: the file has no nesting deeper
  // than at-rules, so a "block" is the span between a `{` that opens at depth 0
  // and its matching `}`. Catches a rule that swallowed its neighbours (the
  // classic symptom of a missing closing brace).
  const lines = themeText().split('\r\n');
  let depth = 0;
  let start = 0;
  let startLine = '';
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (depth === 0 && opens > closes) {
      start = i;
      startLine = line.trim().slice(0, 70);
    }
    depth += opens - closes;
    if (depth <= 0) {
      const span = i - start + 1;
      if (span > MAX_BLOCK_LINES) offenders.push(`${span} lines at line ${start + 1}: ${startLine}`);
      depth = 0;
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `rule blocks longer than ${MAX_BLOCK_LINES} lines (usually a missing closing brace):\n  ${offenders.join('\n  ')}`,
  );
});

test('no line is absurdly long (data URIs excepted)', () => {
  const lines = themeText().split('\r\n');
  const offenders = [];
  for (const [i, line] of lines.entries()) {
    if (line.length <= MAX_LINE_LENGTH) continue;
    // Long lines are legitimate for embedded assets and for very long selector lists.
    if (/data:/.test(line)) continue;
    offenders.push(`line ${i + 1}: ${line.length} chars`);
  }
  assert.deepEqual(offenders, [], `over-long lines:\n  ${offenders.join('\n  ')}`);
});

test('the embedded-asset share of the file is reported (diagnostic)', (t) => {
  const text = themeText();
  const total = Buffer.byteLength(text, 'utf8');
  const embedded = base64Bytes(text);
  const fonts = [...text.matchAll(FONT_DATA_RE)].reduce((n, m) => n + m[1].length, 0);
  t.diagnostic(
    `theme.css ${formatMb(total)}: fonts ${formatMb(fonts)} (${((fonts / total) * 100).toFixed(1)}%), ` +
      `all embedded data ${formatMb(embedded)} (${((embedded / total) * 100).toFixed(1)}%), ` +
      `readable CSS ${formatMb(total - embedded)}`,
  );
});

test('the top-level node count is stable enough to notice a truncation', () => {
  const root = themeRoot();
  assert.ok(root.nodes.length > 4000, `only ${root.nodes.length} top-level nodes — file may be truncated`);
});
