#!/usr/bin/env node
/**
 * build.mjs — assemble src/ into the shipped Obsidian stylesheets.
 *
 * Outputs (repo root):
 *   theme.css     — the Obsidian theme entry point (what users install)
 *   publish.css   — the Obsidian Publish stylesheet (frozen v0.5.4 track)
 *
 * Directives (ordinary CSS comments, so src/ stays lint-clean):
 *   @include <path>   inline another partial, recursively
 *   @font    <path>   expand to url("data:font/woff2;charset=utf-8;base64,…")
 *   @svg     <path>   expand to url("data:image/svg+xml;base64,…")
 *   @raw     <path>   inline a file verbatim (Style Settings YAML blocks)
 *   @manifest …       drop this comment from the output (entry annotations)
 *
 * All paths are relative to src/.
 *
 * Usage:
 *   node scripts/build.mjs            build and write outputs
 *   node scripts/build.mjs --check    build in memory, diff against disk, exit 1 on drift
 *   node scripts/build.mjs --verbose  print per-partial sizes
 *   node scripts/build.mjs --audit    also report orphan partials / unreferenced assets
 *
 * Design notes
 * ------------
 * 1. The pipeline is line-oriented and newline-agnostic: everything is read as
 *    UTF-8, normalised to LF, assembled, then emitted as CRLF in one final step.
 *    Doing the regex work on LF keeps `$` anchors unambiguous — matching against
 *    CRLF text silently fails on `[ \t]*$` because `\r` is not whitespace there.
 *
 * 2. The build is deliberately dumb: no minification, no autoprefixing, no
 *    source maps. The theme is a hand-tuned stylesheet whose selector
 *    specificity and declaration order *are* the product; a transform that
 *    reshuffled either would be a silent behaviour change. Keeping the pipeline
 *    a pure text assembly makes `--check` a meaningful regression test: any
 *    drift between src/ and the committed theme.css is a real, intentional diff.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

const OUTPUT_EOL = '\r\n';

// Directive grammar: `@<kind> <path>` inside a CSS comment. The path must look
// like a relative path — no whitespace, no angle brackets — so prose that merely
// *mentions* a directive cannot be mistaken for one.
const DIR_PATH = String.raw`([A-Za-z0-9._/-]+)`;
const includeRe = () => new RegExp(String.raw`^[ \t]*/\*@include[ \t]+${DIR_PATH}[ \t]*\*/[ \t]*$`, 'gm');
const FONT_RE = new RegExp(String.raw`/\*@font[ \t]+${DIR_PATH}[ \t]*\*/`, 'g');
const SVG_RE = new RegExp(String.raw`/\*@svg[ \t]+${DIR_PATH}[ \t]*\*/`, 'g');
const RAW_RE = new RegExp(String.raw`/\*@raw[ \t]+${DIR_PATH}[ \t]*\*/`, 'g');

/**
 * Manifest annotations are notes for humans that live in the entry file but
 * must not reach the shipped stylesheet. The whole comment is removed, together
 * with the newline that followed it, so surrounding layout is untouched.
 */
const MANIFEST_RE = /^[ \t]*\/\*@manifest\b[\s\S]*?\*\/[ \t]*\n?/gm;

// ---------------------------------------------------------------------------
// errors + helpers
// ---------------------------------------------------------------------------

class BuildError extends Error {}

/** Read a file from src/, contained to the tree, as LF-normalised UTF-8. */
function readSrc(rel, from) {
  const abs = path.resolve(SRC, rel);
  if (abs !== SRC && !abs.startsWith(SRC + path.sep)) {
    throw new BuildError(`directive escapes src/: "${rel}" (from ${from})`);
  }
  if (!fs.existsSync(abs)) {
    throw new BuildError(`missing file: ${rel} (referenced from ${from})`);
  }
  return fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Read a partial for inlining.
 *
 * Partials are stored as normal POSIX text files (trailing newline included) so
 * editors and git treat them well. When inlined, the directive line's own
 * terminator supplies the final newline, so exactly one trailing newline is
 * stripped here to avoid doubling the line break.
 */
function readSrcForInline(rel, from) {
  const text = readSrc(rel, from);
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function readSrcBinary(rel) {
  const abs = path.resolve(SRC, rel);
  if (abs !== SRC && !abs.startsWith(SRC + path.sep)) {
    throw new BuildError(`directive escapes src/: "${rel}"`);
  }
  if (!fs.existsSync(abs)) throw new BuildError(`missing file: ${rel}`);
  return fs.readFileSync(abs);
}

// ---------------------------------------------------------------------------
// directive expansion
// ---------------------------------------------------------------------------

/**
 * Expand @include recursively. A partial's content replaces the directive line
 * wholesale; because partial files carry no trailing newline of their own, the
 * newline that terminated the directive line survives and keeps the layout exact.
 */
function expandIncludes(text, stack = []) {
  const cleaned = text.replace(MANIFEST_RE, '');

  return cleaned.replace(includeRe(), (_m, rel) => {
    if (stack.includes(rel)) throw new BuildError(`include cycle: ${[...stack, rel].join(' -> ')}`);
    if (stack.length > 32) throw new BuildError(`include depth exceeded at "${rel}"`);

    const inner = readSrcForInline(rel, stack.at(-1) ?? 'entries/theme.css');
    return expandIncludes(inner, [...stack, rel]);
  });
}

/**
 * Font container -> MIME type.
 *
 * The MIME type is derived from the file extension, and the extractor sets the
 * extension by sniffing the actual magic bytes. That chain matters: the upstream
 * theme labelled five bare-TrueType fonts as `font/woff2`, and because browsers
 * sniff the container the lie was harmless at runtime and therefore permanent.
 * Deriving the label from the bytes keeps the declaration honest.
 */
const FONT_MIME = new Map([
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.ttc', 'font/collection'],
]);

/** Replace asset directives with their data: URIs / verbatim content. */
function expandAssets(text) {
  const b64 = (rel) => readSrcBinary(rel).toString('base64');

  let out = text.replace(FONT_RE, (_m, rel) => {
    const ext = path.extname(rel).toLowerCase();
    const mime = FONT_MIME.get(ext);
    if (!mime) {
      throw new BuildError(
        `@font: unsupported font container "${ext}" (${rel}). ` +
          `Known: ${[...FONT_MIME.keys()].join(', ')}`,
      );
    }
    return `url("data:${mime};charset=utf-8;base64,${b64(rel)}")`;
  });

  out = out.replace(SVG_RE, (_m, rel) => {
    if (path.extname(rel).toLowerCase() !== '.svg') {
      throw new BuildError(`@svg expects .svg, got "${rel}"`);
    }
    return `url("data:image/svg+xml;base64,${b64(rel)}")`;
  });

  // Style Settings blocks span several lines and must be inlined verbatim.
  out = out.replace(RAW_RE, (_m, rel) => readSrcForInline(rel, 'raw directive'));

  return out;
}

// ---------------------------------------------------------------------------
// outputs
// ---------------------------------------------------------------------------

/** Assemble src/entries/theme.css into the final stylesheet text (LF). */
function buildThemeLf() {
  const entry = path.join(SRC, 'entries', 'theme.css');
  if (!fs.existsSync(entry)) {
    throw new BuildError('src/entries/theme.css not found — run `node scripts/extract.mjs` first');
  }
  const text = fs.readFileSync(entry, 'utf8').replace(/\r\n/g, '\n');
  return expandAssets(expandIncludes(text));
}

/**
 * publish.css is a frozen legacy track (v0.5.4). It is not regenerated from
 * src/; it is copied from src-publish/ so the shipped file and its source cannot
 * drift apart without a visible diff. Returns null while the track is unmigrated.
 */
function buildPublish() {
  const frozen = path.join(ROOT, 'src-publish', 'publish.css');
  return fs.existsSync(frozen) ? fs.readFileSync(frozen) : null;
}

// ---------------------------------------------------------------------------
// diff reporting
// ---------------------------------------------------------------------------

function truncate(s, n = 150) {
  return s.length > n ? `${s.slice(0, n)}… (${s.length} chars)` : s;
}

/**
 * Describe the first line where `built` (what src/ produces) and `disk` (what is
 * committed) diverge, with a little context.
 */
function describeDrift(built, disk) {
  const b = built.split('\n');
  const d = disk.split('\n');
  let i = 0;
  while (i < b.length && i < d.length && b[i] === d[i]) i++;
  if (i === b.length && i === d.length) return null;

  const lo = Math.max(0, i - 2);
  const hi = Math.min(i + 2, Math.max(b.length, d.length) - 1);
  const lines = [];
  for (let k = lo; k <= hi; k++) {
    const marker = k === i ? '>>' : '  ';
    lines.push(`${marker} line ${k + 1}`);
    lines.push(`     built : ${b[k] === undefined ? '<eof>' : truncate(b[k])}`);
    lines.push(`     disk  : ${d[k] === undefined ? '<eof>' : truncate(d[k])}`);
  }
  return { line: i + 1, detail: lines.join('\n') };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// tree audit
// ---------------------------------------------------------------------------

/**
 * Report files that exist but are never reached from the entry, and vice versa.
 *
 * An orphaned partial is the quiet failure mode of a manifest-driven build: you
 * add a file, forget the `@include`, and the CSS silently never ships. The
 * inverse — an `@include` pointing at a file that is gone — is caught during
 * expansion, but listing both together makes the diagnosis obvious.
 */
function auditTree() {
  const entryRel = 'entries/theme.css';
  const entryPath = path.join(SRC, entryRel);
  if (!fs.existsSync(entryPath)) return null;

  const entryText = fs.readFileSync(entryPath, 'utf8').replace(/\r\n/g, '\n');
  const includes = [...entryText.matchAll(new RegExp(String.raw`^[ \t]*/\*@include[ \t]+${DIR_PATH}[ \t]*\*/[ \t]*$`, 'gm'))].map(
    (m) => m[1],
  );

  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };

  const rel = (abs) => path.relative(SRC, abs).split(path.sep).join('/');
  const partials = walk(SRC)
    .filter((f) => f.endsWith('.css'))
    .map(rel)
    .filter((f) => f !== entryRel);

  const orphans = partials.filter((f) => !includes.includes(f));
  const duplicates = includes.filter((v, i) => includes.indexOf(v) !== i);
  const missing = includes.filter((r) => !fs.existsSync(path.join(SRC, r)));

  // A partial must be independently parseable: no file may end inside an
  // unterminated comment, and none may begin mid-comment. Otherwise the partial
  // is only valid in the exact concatenation order it happened to be carved in,
  // which defeats the point of splitting and breaks editors and linters.
  const unbalanced = [];
  for (const f of [...includes]) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n');
    let inComment = false;
    for (let i = 0; i < text.length; i++) {
      if (!inComment && text[i] === '/' && text[i + 1] === '*') {
        inComment = true;
        i++;
      } else if (inComment && text[i] === '*' && text[i + 1] === '/') {
        inComment = false;
        i++;
      }
    }
    if (inComment) unbalanced.push(f);
  }

  return { includes, partials, orphans, duplicates, missing, unbalanced };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const verbose = argv.includes('--verbose');
  const audit = argv.includes('--audit');
  const known = ['--check', '--verbose', '--audit'];
  const unknown = argv.filter((a) => !known.includes(a));
  if (unknown.length) {
    console.error(`unknown argument(s): ${unknown.join(' ')}`);
    console.error('usage: node scripts/build.mjs [--check] [--verbose] [--audit]');
    process.exit(2);
  }

  // --- audit --------------------------------------------------------------
  // Runs before building: an orphaned partial means CSS that never ships, which
  // is worth knowing even when the build itself succeeds.
  if (audit) {
    const report = auditTree();
    if (!report) {
      console.error('audit: src/entries/theme.css not found');
      process.exit(1);
    }
    console.log(`audit: ${report.includes.length} includes, ${report.partials.length} partials`);
    let bad = false;
    const problems = [
      ['orphan partial (never @include\'d)', report.orphans],
      ['duplicate @include', report.duplicates],
      ['missing @include target', report.missing],
      ['partial ends inside an unterminated comment', report.unbalanced],
    ];
    for (const [label, list] of problems) {
      if (!list.length) continue;
      bad = true;
      console.error(`\nx ${label} (${list.length}):`);
      for (const item of list) console.error(`   ${item}`);
    }
    if (bad) {
      console.error('\naudit FAILED — add the missing @include, or delete the orphan file');
      process.exit(1);
    }
    console.log('audit: tree is consistent');
    if (!check) process.exit(0);
  }

  const t0 = process.hrtime.bigint();

  const outputs = [
    {
      name: 'theme.css',
      lf: buildThemeLf(),
    },
  ];
  const publish = buildPublish();
  if (publish) outputs.push({ name: 'publish.css', buf: publish });

  // LF -> CRLF is the single, final newline conversion.
  for (const out of outputs) {
    if (!out.buf) out.buf = Buffer.from(out.lf.replace(/\n/g, OUTPUT_EOL), 'utf8');
  }

  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  if (check) {
    let failed = false;
    for (const out of outputs) {
      const target = path.join(ROOT, out.name);
      if (!fs.existsSync(target)) {
        console.error(`x ${out.name}: missing on disk`);
        failed = true;
        continue;
      }
      const onDisk = fs.readFileSync(target);
      if (onDisk.equals(out.buf)) {
        console.log(`ok ${out.name}  ${fmtSize(out.buf.length)}  ${sha256(out.buf).slice(0, 12)}`);
        continue;
      }
      failed = true;
      console.error(`x  ${out.name}: build output differs from disk`);
      console.error(`   built : ${fmtSize(out.buf.length)}  sha ${sha256(out.buf).slice(0, 12)}`);
      console.error(`   disk  : ${fmtSize(onDisk.length)}  sha ${sha256(onDisk).slice(0, 12)}`);
      const drift = describeDrift(out.buf.toString('utf8').replace(/\r\n/g, '\n'), onDisk.toString('utf8').replace(/\r\n/g, '\n'));
      if (drift) console.error(drift.detail);
      console.error('   fix: run `node scripts/build.mjs` and review the diff');
    }
    console.log(failed ? '\nbuild check FAILED' : `\nbuild check passed (${ms.toFixed(0)} ms)`);
    process.exit(failed ? 1 : 0);
  }

  for (const out of outputs) {
    const target = path.join(ROOT, out.name);
    const before = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (before && before.equals(out.buf)) {
      console.log(`=  ${out.name}  unchanged  ${fmtSize(out.buf.length)}`);
      continue;
    }
    fs.writeFileSync(target, out.buf);
    console.log(`+  ${out.name}  ${fmtSize(out.buf.length)}${before ? ` (was ${fmtSize(before.length)})` : ' (new)'}`);
  }

  if (verbose) {
    console.log('\npartials:');
    for (const line of listPartials()) console.log(`   ${line}`);
  }
  console.log(`\nbuilt in ${ms.toFixed(0)} ms`);
}

function listPartials() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.css')) {
        out.push(`${path.relative(SRC, p).replace(/\\/g, '/').padEnd(52)} ${fmtSize(fs.statSync(p).size)}`);
      }
    }
  };
  if (fs.existsSync(SRC)) walk(SRC);
  return out.sort();
}

try {
  main();
} catch (err) {
  if (err instanceof BuildError) {
    console.error(`build error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
