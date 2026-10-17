/**
 * Shared loaders and parsers for the Willemstad-X test suite.
 *
 * Everything here is deliberately dependency-light: Node built-ins plus postcss
 * (already a devDependency for stylelint's ecosystem) and `yaml`.
 *
 * theme.css is 5 MB and parses in ~130 ms, so each test file loads it once and
 * memoises. Do not add per-assertion re-reads.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import postcss from 'postcss';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const THEME_PATH = path.join(ROOT, 'theme.css');
export const PUBLISH_PATH = path.join(ROOT, 'publish.css');
export const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
export const VERSIONS_PATH = path.join(ROOT, 'versions.json');
export const SRC_DIR = path.join(ROOT, 'src');
export const SETTINGS_DIR = path.join(SRC_DIR, 'style-settings');
export const FONT_FILES_DIR = path.join(SRC_DIR, 'assets', 'fonts');
export const ICON_FILES_DIR = path.join(SRC_DIR, 'assets', 'icons');

/** Windows-safe relative path with forward slashes, for stable test output. */
export const rel = (abs) => path.relative(ROOT, abs).replace(/\\/g, '/');

const cache = new Map();

export function themeBytes() {
  if (!cache.has('bytes')) cache.set('bytes', readFileSync(THEME_PATH));
  return cache.get('bytes');
}

export function themeText() {
  if (!cache.has('text')) cache.set('text', themeBytes().toString('utf8'));
  return cache.get('text');
}

/** Parsed postcss Root for theme.css. Throws (CssSyntaxError) on bad CSS. */
export function themeRoot() {
  if (!cache.has('root')) cache.set('root', postcss.parse(themeText(), { from: THEME_PATH }));
  return cache.get('root');
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Style Settings panels live in CSS comments. Two opening forms exist in this
 * theme and both must be matched — the second form is easy to miss:
 *
 *   /* @settings          <- 10 panels
 *   /*
 *   @settings             <- 2 panels (cssc-latex, cssc-cornell)
 */
const SETTINGS_RE = /\/\*[ \t]*(?:\r?\n[ \t]*)?@settings\b([\s\S]*?)\*\//g;

/**
 * @returns {{index:number, line:number, body:string}[]}
 *   `line` is 1-based in theme.css; `body` is the YAML text with the leading
 *   newline removed.
 */
export function settingsBlocks(text = themeText()) {
  const out = [];
  for (const m of text.matchAll(SETTINGS_RE)) {
    out.push({
      index: m.index,
      line: text.slice(0, m.index).split('\n').length,
      body: m[1].replace(/^\r?\n/, ''),
    });
  }
  return out;
}

/**
 * YAML requires continuation lines of a multi-line double-quoted (flow) scalar
 * to be indented deeper than the key. `yaml@2` enforces that; `js-yaml` (what
 * Style Settings itself uses) does not. KNOWN-ISSUES "Bug A" is exactly this,
 * so layer 1 of the panel tests parses a relaxed copy and layer 2 asserts that
 * strict parsing still fails in exactly one place.
 *
 * The relaxation re-indents every line that sits inside an open double-quoted
 * scalar. It changes indentation only, never content, so ids/names/types are
 * unaffected.
 */
export function relaxFlowScalars(text) {
  const out = [];
  let open = false;
  for (const line of text.split(/\r?\n/)) {
    out.push(open ? `  ${line}` : line);
    const quotes = line.match(/(?<!\\)"/g);
    if (quotes && quotes.length % 2 === 1) open = !open;
  }
  return out.join('\n');
}

/** Parse one panel body, falling back to the relaxed form. Never throws. */
export function parsePanel(body) {
  try {
    return { doc: YAML.parse(body), strict: true, error: null };
  } catch (error) {
    const doc = YAML.parse(relaxFlowScalars(body));
    return { doc, strict: false, error };
  }
}

/** All panels in theme.css, parsed (tolerantly) and annotated. */
export function panels() {
  return settingsBlocks().map((b, i) => ({ ...b, i, ...parsePanel(b.body) }));
}

/** Strip the `/* … *\/` fence from a src/style-settings/*.yaml file. */
export function stripSettingsFence(raw) {
  const at = raw.indexOf('@settings');
  if (at === -1) throw new Error('no @settings marker');
  return raw
    .slice(at + '@settings'.length)
    .replace(/^\r?\n/, '')
    .replace(/\*\/\s*$/, '');
}

/** Sorted list of the Style Settings source files. */
export function settingsSourceFiles() {
  return readdirSync(SETTINGS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => path.join(SETTINGS_DIR, f));
}

/** Every .css partial under src/ (absolute paths), excluding the build manifest. */
export function srcCssFiles({ includeEntry = false } = {}) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.css')) out.push(p);
    }
  };
  if (statSync(SRC_DIR, { throwIfNoEntry: false })) walk(SRC_DIR);
  const filtered = includeEntry ? out : out.filter((p) => !p.includes(`${path.sep}entries${path.sep}`));
  return filtered.sort();
}

/**
 * The set of class-toggles is applied by Style Settings as `body.<id>`; the
 * theme must reference the id *somewhere* or the switch is dead weight.
 * Returns the ids with how they are referenced.
 */
export function classToggleReferences(ids, text = themeText()) {
  // Comments contain commented-out rules and prose; they are not references.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map();
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asClass = new RegExp(`\\.${esc}(?![A-Za-z0-9_-])`).test(code);
    const asDataId = new RegExp(`data-id="${esc}"`).test(code);
    out.set(id, { asClass, asDataId });
  }
  return out;
}

/**
 * Collect `var(--x)` references and `--x:` definitions from the compiled
 * stylesheet using the postcss AST, not a regex. The AST walk also catches
 * `var()` inside at-rule preludes (`@container style(--x: …)`), which a
 * declaration-only scan misses.
 */
export function variableUsage(root = themeRoot()) {
  const refs = new Map();
  const defs = new Set();
  root.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) defs.add(decl.prop);
    for (const m of decl.value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      refs.set(m[1], (refs.get(m[1]) ?? 0) + 1);
    }
  });
  root.walkAtRules((at) => {
    for (const m of at.params.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      refs.set(m[1], (refs.get(m[1]) ?? 0) + 1);
    }
  });
  const undefinedVars = [...refs.keys()].filter((v) => !defs.has(v)).sort();
  return { refs, defs, undefinedVars };
}

export { postcss, YAML };
