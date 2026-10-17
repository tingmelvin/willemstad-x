#!/usr/bin/env node
/**
 * extract.mjs — one-shot migration: theme.css (monolith) -> src/ (modular)
 *
 * This script is the provenance record of the refactor. It reads the pristine
 * compiled theme and carves it at its own structural boundaries. It is
 * intentionally re-runnable: running it again regenerates src/ from the current
 * theme.css.
 *
 * Losslessness
 * ------------
 * The carve is a partition of the source lines, so reassembly is exact by
 * construction:
 *
 *     original = lines.join('\n')          (after CRLF normalisation)
 *     chunks   = [prefix, ...sections]     (a partition of `lines`)
 *     build    = flatten(chunks).join('\n')   (== original)
 *
 * `node scripts/build.mjs --check` proves it on every run.
 *
 * Payload hoisting
 * ----------------
 * Three kinds of inline payload are lifted out of the CSS text so they stop
 * polluting diffs and start being editable as what they are:
 *
 *   @font-face base64 woff2  -> src/assets/fonts/*.woff2    (@font directive)
 *   SVG data: URIs           -> src/assets/icons/*.svg      (@svg  directive)
 *   /* @settings YAML blocks -> src/style-settings/*.yaml   (@raw  directive)
 *
 * Usage:
 *   node scripts/extract.mjs [--input theme.css] [--out src] [--force]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { input: 'theme.css', out: 'src', force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') opts.input = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/extract.mjs [--input theme.css] [--out src] [--force]');
      process.exit(0);
    } else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Module routing
//
// The compiled theme carries a stable two-letter section namespace (AA, AB, CA,
// PC, …). We map that namespace onto directories. First matching prefix wins.
// A section that matches no rule is a hard error — silence there would silently
// mis-file a chunk.
// ---------------------------------------------------------------------------

const RULES = [
  // -- framing / metadata ---------------------------------------------------
  ['AA', 'meta'],
  // -- design tokens --------------------------------------------------------
  ['AB', 'root'],
  ['AC', 'root'],
  // -- form controls --------------------------------------------------------
  ['AI', 'interactives'],
  // -- loose elements -------------------------------------------------------
  ['AJ', 'elements'],
  ['AT', 'elements'],
  // -- colour system --------------------------------------------------------
  ['CA', 'colour'],
  ['CB', 'colour'],
  ['CC', 'colour'],
  ['CD', 'colour'],
  ['CR', 'colour'],
  ['CX', 'colour'],
  // -- application shell ----------------------------------------------------
  ['DA', 'app-ui'],
  ['DB', 'app-ui'],
  ['DC', 'app-ui'],
  ['DS', 'app-ui'],
  ['DV', 'app-ui'],
  // -- editor & reading view ------------------------------------------------
  ['EA', 'editor'],
  ['EB', 'editor'],
  ['ED', 'editor'],
  ['EE', 'editor'],
  ['EF', 'editor'],
  ['EH', 'editor'],
  ['EL', 'editor'],
  ['ES', 'editor'],
  ['ET', 'editor'],
  ['EV', 'editor'],
  ['EY', 'editor'],
  // -- opt-in CSSClass features --------------------------------------------
  ['EX', 'cssclass'],
  // -- modals ---------------------------------------------------------------
  ['MA', 'modals'],
  ['MB', 'modals'],
  ['MC', 'modals'],
  ['MD', 'modals'],
  // -- plugin integrations --------------------------------------------------
  ['PB', 'plugins/core'],
  ['PC', 'plugins/community'],
  // -- cross-cutting late overrides ----------------------------------------
  ['X1', 'overrides'],
  // -- embedded @font-face declarations ------------------------------------
  // NOTE: distinct from assets/fonts/, which holds the .woff2 payloads these
  // declarations point at. "font-faces" is the CSS; "assets/fonts" is the bytes.
  ['AF', 'font-faces'],
];

/** Sections whose header is prose rather than a namespace code. */
const NAMED_SECTIONS = new Map([
  ['Copyright', 'meta'],
  ['Willemstad Specific Styling', 'meta'],
  // One section holds nothing but `/* @settings … *\/` blocks; they are hoisted
  // to .yaml files and the section itself reduces to a list of @raw directives.
  ['Style Settings', 'style-settings'],
]);

function routeSection(id) {
  const named = NAMED_SECTIONS.get(id);
  if (named) return named;
  for (const [prefix, dir] of RULES) {
    if (id.startsWith(prefix)) return dir;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** Lowercase ASCII slug, safe on every filesystem. */
function slugify(text, max = 48) {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return '';
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > max / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

/** Zero-padded global index so a directory listing still reflects cascade order. */
const indexPrefix = (i) => String(i).padStart(3, '0');

// ---------------------------------------------------------------------------
// Structural scan
// ---------------------------------------------------------------------------

const BOX_OPEN = /^\/\* \u2500+$/; // "/* ───────…" at column 0
const BOX_CLOSE = /\u2500+ \*\/$/; // "─────── */"

/**
 * A top-level section marker is a line starting with exactly one ">".
 * Deeper markers (">> …", ">>> …") are sub-headings *inside* a section and must
 * not split it. The bare "> " form is legal too: the section takes its name from
 * the following "\ Title" line.
 */
const MARK = /^> (?!>)\s*(.*)$/;

/**
 * Walk the lines and report, for each, whether it begins inside a CSS comment.
 *
 * This matters because the licence block contains a `> Copyright` line at column
 * 0 — visually identical to a section marker, but it sits inside the `/*! … *\/`
 * banner. Splitting there would leave one partial holding an unterminated comment
 * and the next one starting mid-comment, which is unparseable in isolation and
 * hostile to editors, linters and anyone reading a single file.
 */
function commentStatePerLine(lines) {
  const inside = new Array(lines.length);
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    inside[i] = inComment;
    const line = lines[i];
    let j = 0;
    while (j < line.length) {
      if (!inComment && line[j] === '/' && line[j + 1] === '*') {
        inComment = true;
        j += 2;
        continue;
      }
      if (inComment && line[j] === '*' && line[j + 1] === '/') {
        inComment = false;
        j += 2;
        continue;
      }
      j++;
    }
  }
  return inside;
}

function findSections(lines) {
  const insideAtStart = commentStatePerLine(lines);
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    // A section opens with a box-comment opener at column 0. That opener is itself
    // a comment, so it must NOT be rejected as "inside a comment" — it *is* the
    // structure. What must be excluded is an opener that sits within an already
    // open comment (the `/*!` licence banner contains a `> Copyright` line that is
    // visually identical to a section marker); `insideAtStart[i]` detects exactly
    // that, because it is the state *before* this line's own opener runs.
    if (BOX_OPEN.test(lines[i]) && i + 1 < lines.length && MARK.test(lines[i + 1]) && !insideAtStart[i]) {
      starts.push(i);
    }
  }
  return starts.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const header = [];
    let j = start + 1;
    while (j < end && !BOX_CLOSE.test(lines[j])) {
      header.push(lines[j]);
      j++;
    }
    let id = (MARK.exec(lines[start + 1]) || [, ''])[1].trim();
    if (!id) {
      const named = header.find((h) => /^\\\s*\S/.test(h));
      id = named ? named.replace(/^\\\s*/, '').trim() : 'untitled';
    }
    return { start, end, id, header, lines: lines.slice(start, end) };
  });
}

// ---------------------------------------------------------------------------
// Payload hoisting
// ---------------------------------------------------------------------------

/** Registry that hands out collision-free filenames and dedupes identical payloads. */
class AssetRegistry {
  constructor() {
    this.byHash = new Map(); // sha256 -> rel path
    this.names = new Set();
    this.files = [];
  }

  /**
   * Register a payload. Identical bytes reuse the same file; distinct bytes get
   * the next free name derived from `base`.
   */
  add(kind, dir, base, ext, buf, directiveKind) {
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const existing = this.byHash.get(hash);
    if (existing) return existing;

    let name = `${base}.${ext}`;
    let n = 2;
    while (this.names.has(name)) name = `${base}-${n++}.${ext}`;
    this.names.add(name);

    const rel = `${dir}/${name}`;
    this.byHash.set(hash, rel);
    this.files.push({
      kind,
      rel,
      data: buf,
      directive: `/*@${directiveKind} ${rel} */`,
    });
    return rel;
  }
}

/**
 * Split one section into ordered chunks at its own internal banners.
 *
 * Only a very specific banner shape is trusted:
 *
 *     /* =================================================================== *\/
 *
 *     /* CB00-06 | Lightness Palette Override Classes *\/
 *
 *     /* =================================================================== *\/
 *
 * That 5-line sandwich is unambiguous — it cannot be produced by accident — and
 * the text before the first banner is returned as a leading chunk so nothing is
 * lost. Sections without banners come back as a single chunk.
 */
const SUB_RULE = /^\/\* ={10,} \*\/$/;
const SUB_TITLE = /^\/\* ([A-Za-z0-9][A-Za-z0-9-]*) \| (.+?) \*\/$/;

function splitSection(lines) {
  const cuts = [];
  for (let i = 0; i < lines.length - 4; i++) {
    if (
      SUB_RULE.test(lines[i]) &&
      lines[i + 1] === '' &&
      SUB_TITLE.test(lines[i + 2]) &&
      lines[i + 3] === '' &&
      SUB_RULE.test(lines[i + 4])
    ) {
      cuts.push({ at: i, id: SUB_TITLE.exec(lines[i + 2])[1], title: SUB_TITLE.exec(lines[i + 2])[2] });
    }
  }
  if (cuts.length < 2) return [{ lines, subId: null, subTitle: null }];

  const chunks = [];
  for (let k = 0; k < cuts.length; k++) {
    const end = k + 1 < cuts.length ? cuts[k + 1].at : lines.length;
    // The text before the first banner is the section's own header block (its
    // "> CB00 / \ Title / version" banner). Fold it into the first chunk so no
    // file consists of nothing but a banner.
    const start = k === 0 ? 0 : cuts[k].at;
    chunks.push({
      lines: lines.slice(start, end),
      subId: cuts[k].id,
      subTitle: cuts[k].title,
    });
  }
  return chunks;
}

/**
 * Identify a font container from its magic bytes.
 *
 * The compiled theme labels every embedded font `data:font/woff2`, but five of
 * them are bare TrueType (`00 01 00 00`), not WOFF2 (`wOF2`). Chromium sniffs the
 * container and loads them anyway, so the mislabelling is invisible at runtime —
 * which is exactly why it survived. Trusting the label would propagate the lie
 * into `src/` and into any future re-encoding, so the bytes decide the extension.
 */
function sniffFontFormat(buf) {
  const magic = buf.subarray(0, 4).toString('binary');
  if (magic === 'wOF2') return { ext: 'woff2', label: 'WOFF2' };
  if (magic === 'wOFF') return { ext: 'woff', label: 'WOFF' };
  if (magic === 'OTTO') return { ext: 'otf', label: 'OpenType/CFF' };
  if (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) {
    return { ext: 'ttf', label: 'TrueType' };
  }
  if (magic === 'ttcf') return { ext: 'ttc', label: 'TrueType collection' };
  return {
    ext: 'bin',
    label: `unknown (${[...buf.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ')})`,
  };
}

/**
 * CSS `format()` keywords are not file extensions.
 *
 * `.ttf` is spelled `truetype` in a `src` descriptor, `.otf` is `opentype`, and
 * `.ttc` is `collection`. Comparing a hint against the extension directly reports
 * a false mismatch for every TrueType face — which is exactly what happened the
 * first time these five were relabelled, and it buried the one signal that
 * mattered under five lines of noise.
 */
const FORMAT_KEYWORDS = new Map([
  ['woff2', ['woff2']],
  ['woff', ['woff']],
  ['ttf', ['truetype']],
  ['otf', ['opentype']],
  ['ttc', ['collection']],
]);

/** Does a `format("…")` hint describe a file with this extension? */
export function hintMatchesExtension(hint, ext) {
  const keywords = FORMAT_KEYWORDS.get(ext);
  if (!keywords) return hint === ext;
  // `woff` must not match `woff2`, so accept only the exact keyword or a
  // `-variant` suffix (`woff2-variations`, `truetype-variations`, …).
  return keywords.some((k) => hint === k || hint.startsWith(`${k}-`));
}

/**
 * Rewrite every @font-face block, replacing its base64 payload with a @font
 * directive and naming the file after the face it actually describes.
 *
 * The block is processed as a unit because the declarations that identify a face
 * (`font-family`, `font-weight`, `font-style`) appear *after* the `src:` line in
 * this stylesheet, so a streaming pass cannot know the name when it sees the
 * payload.
 */
const FONT_DATA_RE = /url\("data:font\/[a-z0-9.+-]+;charset=utf-8;base64,([A-Za-z0-9+/=]+)"\)/;

function hoistFonts(lines, registry, report) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*@font-face\s*\{\s*$/.test(lines[i])) {
      out.push(lines[i]);
      continue;
    }

    // Collect the whole block: @font-face bodies are flat, so the first line
    // that is exactly "}" at the block's indentation closes it.
    let j = i + 1;
    while (j < lines.length && !/^\s*\}\s*$/.test(lines[j])) j++;
    if (j >= lines.length) throw new Error(`unterminated @font-face block at line ${i + 1}`);

    const block = lines.slice(i, j + 1);
    const body = block.slice(1, -1);

    const read = (prop) => {
      const line = body.find((l) => new RegExp(`^\\s*${prop}\\s*:`).test(l));
      return line ? line.replace(new RegExp(`^\\s*${prop}\\s*:\\s*`), '').replace(/;\s*$/, '').trim() : null;
    };

    const family = (read('font-family') ?? 'font').replace(/["']/g, '');
    const style = (read('font-style') ?? 'normal').toLowerCase();
    const weightRaw = (read('font-weight') ?? 'normal').toLowerCase();

    // Human-meaningful weight token: variable ranges collapse to "var".
    const weightToken = weightRaw.includes(' ')
      ? 'var'
      : weightRaw === 'normal'
        ? '400'
        : weightRaw === 'bold'
          ? '700'
          : weightRaw.replace(/\s+/g, '');

    const base = [slugify(family, 28), weightToken, style === 'normal' ? '' : slugify(style, 10)]
      .filter(Boolean)
      .join('-');

    const rewritten = block.map((line) => {
      const m = FONT_DATA_RE.exec(line);
      if (!m) return line;
      const buf = Buffer.from(m[1], 'base64');
      const { ext, label } = sniffFontFormat(buf);
      const rel = registry.add('font', 'assets/fonts', base, ext, buf, 'font');

      // The MIME type and the `format()` hint both claim a container; flag any
      // that disagree with the actual bytes.
      const declared = /data:font\/([a-z0-9.+-]+)/.exec(line)?.[1] ?? '?';
      const hint = /format\(\s*"([^"]+)"/.exec(block.join('\n'))?.[1] ?? null;
      const face = `${family} ${style} ${weightRaw}`;
      if (declared !== ext) {
        report?.push(`${face}: declared font/${declared}, actually ${label}`);
      }
      if (hint && !hintMatchesExtension(hint, ext)) {
        report?.push(`${face}: format("${hint}") disagrees with ${label}`);
      }

      return line.replace(FONT_DATA_RE, `/*@font ${rel} */`);
    });

    out.push(...rewritten);
    i = j;
  }
  return out;
}

/** Rewrite base64 SVG data: URIs, naming each file after its custom property. */
const SVG_DATA_RE = /url\("data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"\)/g;

function hoistSvg(lines, registry) {
  return lines.map((line) => {
    if (!line.includes('data:image/svg+xml;base64,')) return line;

    // The custom property on this line is the best available name.
    const prop = /(--[a-z0-9-]+)\s*:/.exec(line);
    const base = prop ? slugify(prop[1].replace(/^--/, ''), 44) : 'icon';

    // The whole `url("data:…")` expression is replaced by a bare directive; the
    // build re-emits `url("…")` around the data URI. Emitting the directive
    // *inside* the quotes would double-wrap it.
    return line.replace(SVG_DATA_RE, (_m, b64) => {
      const buf = Buffer.from(b64, 'base64');
      const rel = registry.add('icon', 'assets/icons', base || 'icon', 'svg', buf, 'svg');
      return `/*@svg ${rel} */`;
    });
  });
}

/**
 * Two opener spellings occur in the wild:
 *
 *     /* @settings        <- same line
 *     /*
 *     @settings          <- on its own line
 *
 * Both are recognised, and the emitted @raw directive expands to the entire
 * original comment including its fences, so the build never guesses.
 */
const SETTINGS_OPEN_SAME_LINE = /^\/\*\s*@settings\s*$/;
const SETTINGS_OPEN_PREV_LINE = /^\/\*\s*$/;
const SETTINGS_OPEN_NEXT_LINE = /^@settings\s*$/;

function hoistSettings(lines, registry, ctx) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let yamlStart = -1;
    let openerLines = null;

    if (SETTINGS_OPEN_SAME_LINE.test(line.trimEnd())) {
      yamlStart = i + 1;
      openerLines = [line];
    } else if (
      SETTINGS_OPEN_PREV_LINE.test(line.trimEnd()) &&
      i + 1 < lines.length &&
      SETTINGS_OPEN_NEXT_LINE.test(lines[i + 1])
    ) {
      yamlStart = i + 2;
      openerLines = [line, lines[i + 1]];
    }

    if (yamlStart === -1) {
      out.push(line);
      continue;
    }

    let j = yamlStart;
    while (j < lines.length && !/^\s*\*\/\s*$/.test(lines[j])) j++;
    if (j >= lines.length) throw new Error(`unterminated @settings block at line ${i + 1}`);

    const yamlLines = lines.slice(yamlStart, j);
    const blockLines = [...openerLines, ...yamlLines, lines[j]];

    const panelName = (yamlLines.find((l) => /^\s*name:/.test(l)) ?? '')
      .replace(/^\s*name:\s*/, '')
      .trim()
      .replace(/^["']|["']$/g, '');
    const panelId = (yamlLines.find((l) => /^\s*id:/.test(l)) ?? '').replace(/^\s*id:\s*/, '').trim();

    const seq = String(ctx.seq).padStart(2, '0');
    const base = slugify(panelId || panelName || `panel-${ctx.seq}`, 44) || `panel-${ctx.seq}`;
    const rel = registry.add(
      'settings',
      'style-settings',
      `${seq}-${base}`,
      'yaml',
      Buffer.from(blockLines.join('\n'), 'utf8'),
      'raw',
    );

    ctx.seq++;
    ctx.panels.push({ name: panelName, id: panelId, file: rel });

    out.push(`/*@raw ${rel} */`);
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(ROOT, opts.input);
  const outDir = path.resolve(ROOT, opts.out);

  if (!fs.existsSync(inputPath)) throw new Error(`input not found: ${inputPath}`);
  if (fs.existsSync(outDir) && !opts.force) {
    throw new Error(`${opts.out}/ already exists — pass --force to regenerate`);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) throw new Error('input has a BOM; refusing to guess');

  // Normalise to LF for all structural work; the build re-emits CRLF.
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  // `split('\n')` on a newline-terminated file yields a trailing '' element that
  // represents "the file ends with a newline" rather than actual content.
  // Dropping it makes every chunk's join() newline-free at the tail, which is
  // what the build's one-newline-strip contract expects. The file's final
  // newline is re-added by the writers.
  if (lines.at(-1) === '') lines.pop();
  if (text !== `${lines.join('\n')}\n`) {
    throw new Error('input is not newline-terminated or contains stray CR — refusing to carve');
  }

  const sections = findSections(lines);
  if (!sections.length) throw new Error('no sections found — is this the compiled theme?');
  const prefix = lines.slice(0, sections[0].start);

  // --- route + validate before writing anything ---------------------------
  const unrouteable = sections.filter((s) => routeSection(s.id) === null);
  if (unrouteable.length) {
    const list = unrouteable.map((s) => `  "${s.id}" (line ${s.start + 1})`).join('\n');
    throw new Error(`cannot route these sections — add a rule to RULES:\n${list}`);
  }

  const plan = sections.map((s, i) => ({
    ...s,
    index: i,
    dir: routeSection(s.id),
    file: `${indexPrefix(i)}-${slugify(s.id, 40) || 'section'}.css`,
  }));

  // --- carve --------------------------------------------------------------
  // Each section becomes one partial, unless it carries its own internal banner
  // sandwich, in which case it is split further so no single file grows past a
  // few hundred lines.
  const registry = new AssetRegistry();
  const settingsCtx = { seq: 1, panels: [] };
  const fontReports = [];
  const written = [];
  let fileSeq = 0;

  for (const s of plan) {
    for (const chunk of splitSection(s.lines)) {
      // Settings first: their YAML must be preserved verbatim, never rewritten by
      // the asset pass. Then fonts (block-scoped), then SVG (line-scoped).
      let work = hoistSettings(chunk.lines, registry, settingsCtx);
      work = hoistFonts(work, registry, fontReports);
      work = hoistSvg(work, registry);

      const base = chunk.subId
        ? `${indexPrefix(fileSeq)}-${slugify(chunk.subId, 40)}`
        : `${indexPrefix(fileSeq)}-${slugify(s.id, 40) || 'section'}`;

      written.push({
        ...s,
        outLines: work,
        dir: s.dir,
        file: `${base}.css`,
        label: chunk.subTitle ? `${s.id} > ${chunk.subTitle}` : s.id,
      });
      fileSeq++;
    }
  }

  // Guard against two chunks landing on the same path (e.g. repeated section ids).
  const seen = new Map();
  for (const f of written) {
    const key = `${f.dir}/${f.file}`;
    if (seen.has(key)) throw new Error(`duplicate partial path: ${key} (${seen.get(key)} vs ${f.label})`);
    seen.set(key, f.label);
  }

  // --- write --------------------------------------------------------------
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of written) {
    const dir = path.join(outDir, f.dir);
    fs.mkdirSync(dir, { recursive: true });
    // Newline contract: every partial is written as  join('\n') + '\n'  and the
    // build strips exactly one trailing '\n' when inlining. That round-trips even
    // when the chunk itself ends in a blank line, because a trailing empty
    // element in `outLines` is then represented by a real blank line in the file.
    fs.writeFileSync(path.join(dir, f.file), `${f.outLines.join('\n')}\n`, 'utf8');
  }
  for (const a of registry.files) {
    const p = path.join(outDir, a.rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, a.data);
  }

  // --- entry manifest -----------------------------------------------------
  // @manifest annotations are stripped at build time, so this header can be as
  // verbose as contributors need without reaching the shipped stylesheet.
  const entryLines = [
    ...prefix,
    '/*@manifest',
    '   Willemstad-X — build entry',
    '',
    '   This file is a manifest. Order is significant: it is the CSS cascade',
    '   order of the compiled theme. Appending is safe; reordering changes the',
    '   rendered result.',
    '',
    '   Each line below is a CSS comment that scripts/build.mjs rewrites:',
    '',
    '     @include <path>   inline another partial, recursively',
    '     @font    <path>   expand to a base64 woff2 data: URI',
    '     @svg     <path>   expand to a base64 SVG data: URI',
    '     @raw     <path>   inline a file verbatim (Style Settings YAML)',
    '',
    '   All paths are relative to src/. See scripts/build.mjs for the grammar.',
    '',
    '   Generated by scripts/extract.mjs — the section order below mirrors the',
    '   original theme.css line order exactly.',
    '*/',
    // No blank line here: the @manifest block and its trailing newline are
    // stripped at build time, so the first section must start on the very next
    // line to reproduce the original layout byte-for-byte.
  ];

  let lastDir = null;
  for (const f of written) {
    if (f.dir !== lastDir) {
      entryLines.push(`/*@manifest ---- ${f.dir} ${'-'.repeat(Math.max(0, 56 - f.dir.length))} */`);
      lastDir = f.dir;
    }
    entryLines.push(`/*@include ${f.dir}/${f.file} */`);
  }

  const entryDir = path.join(outDir, 'entries');
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(path.join(entryDir, 'theme.css'), `${entryLines.join('\n')}\n`, 'utf8');

  // --- report -------------------------------------------------------------
  const byDir = new Map();
  for (const f of written) byDir.set(f.dir, (byDir.get(f.dir) ?? 0) + 1);
  const count = (kind) => registry.files.filter((f) => f.kind === kind).length;

  // Report fonts by their real container, not by the label the source claimed.
  const fontExts = new Map();
  for (const f of registry.files.filter((x) => x.kind === 'font')) {
    const ext = path.extname(f.rel).slice(1);
    fontExts.set(ext, (fontExts.get(ext) ?? 0) + 1);
  }
  const fontSummary = [...fontExts].map(([ext, n]) => `${n} .${ext}`).join(', ');

  console.log(`extracted ${path.relative(ROOT, inputPath)} (${lines.length} lines, ${(raw.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  sections : ${written.length}`);
  console.log(`  fonts    : ${fontSummary}`);
  console.log(`  icons    : ${count('icon')} .svg`);
  console.log(`  settings : ${count('settings')} .yaml`);
  if (fontReports.length) {
    console.log(`  mislabelled font declarations corrected: ${fontReports.length}`);
    for (const r of fontReports) console.log(`    - ${r}`);
  }
  console.log('  modules  :');
  for (const [dir, n] of [...byDir].sort()) console.log(`    ${dir.padEnd(20)} ${n}`);
  console.log(`\nentry: ${path.relative(ROOT, path.join(entryDir, 'theme.css'))}`);
  console.log('next : node scripts/build.mjs --check');
}

main();
