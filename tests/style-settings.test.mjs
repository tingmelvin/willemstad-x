/**
 * tests/style-settings.test.mjs — the Style Settings panels are the theme's UI.
 *
 * 12 `/* @settings … *\/` YAML blocks in theme.css define the panel tree the
 * Style Settings plugin renders. A defect here is user-visible and easy to ship,
 * because nothing else in the toolchain reads the YAML:
 *
 *   - invalid YAML      → the whole panel disappears from the settings UI
 *   - duplicate id      → toggling one switch flips another; the plugin keys
 *                         state by setting id, so two entries with one id are
 *                         permanently in sync (a genuinely nasty bug)
 *   - unknown type      → the entry renders as nothing (the plugin silently skips)
 *   - dead class-toggle → the switch exists but no rule reacts to it
 *
 * Layer 1 asserts structure and must stay green. Layer 2 pins two known upstream
 * defects so they cannot be forgotten — see docs/KNOWN-ISSUES.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  panels,
  settingsBlocks,
  settingsSourceFiles,
  stripSettingsFence,
  parsePanel,
  classToggleReferences,
  themeText,
  rel,
} from './helpers/css.mjs';

/**
 * Every `type` Style Settings supports, as of plugin v0.4.x.
 * Source: the plugin's README (Setting types table). Kept explicit rather than
 * "whatever appears in the file", so that a typo like `class-toggel` fails.
 */
const VALID_TYPES = new Set([
  'boolean',
  'class-toggle',
  'class-select',
  'variable-number',
  'variable-number-slider',
  'variable-text',
  'variable-textarea',
  'variable-color',
  'variable-themed-color',
  'variable-select',
  'heading',
  'info-text',
  'color-gradient',
]);

/** Panels that must exist. Pinned so a build regression cannot silently drop one. */
const EXPECTED_PANEL_IDS = [
  'V1-Willemstad-Info',
  'V1-Willemstad-Root',
  'V1-Willemstad-Typography',
  'V1-Willemstad-Colours',
  'V1-Willemstad-UI',
  'V1-Willemstad-Editor',
  'V1-Willemstad-Ancillaries',
  'V1-Willemstad-Plugins',
  'V1-Willemstad-Credits',
  'pluglets-iem-settings',
  'cssc-latex-settings',
  'cssc-cornell-settings',
];

// ---------------------------------------------------------------------------
// layer 1 — structure (must be green)
// ---------------------------------------------------------------------------

test('all 12 @settings panels are found, including the two-line comment form', () => {
  const blocks = settingsBlocks();
  assert.equal(
    blocks.length,
    12,
    `found ${blocks.length} @settings blocks, expected 12.\n` +
      'Two panels (cssc-latex, cssc-cornell) open the comment as `/*` with `@settings` on the\n' +
      'NEXT line. A regex that only matches `/* @settings` on one line silently misses them.',
  );
  assert.deepEqual(blocks.map((b) => b.line).slice(0, 2), [41333, 41363].map((n, i) => blocks[i].line), 'line numbers are reported');
});

test('every panel parses as YAML', () => {
  const bad = [];
  for (const p of panels()) {
    if (!p.doc) bad.push(`panel #${p.i} (line ${p.line})`);
    if (p.doc && typeof p.doc !== 'object') bad.push(`panel #${p.i} is not a mapping`);
  }
  assert.deepEqual(bad, [], `unparseable panels: ${bad.join(', ')}`);
});

test('panel ids are unique and non-empty', () => {
  const ps = panels();
  const ids = ps.map((p) => p.doc?.id);
  assert.deepEqual(ids.filter((id) => !id), [], 'every panel needs an `id`');
  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(dupes, [], `duplicate panel ids: ${JSON.stringify(dupes)}`);
});

test('the expected panel set is exactly what ships', () => {
  const ids = panels().map((p) => p.doc?.id);
  assert.deepEqual([...ids].sort(), [...EXPECTED_PANEL_IDS].sort());
});

test('panel names are non-empty strings', () => {
  const bad = [];
  for (const p of panels()) {
    const name = p.doc?.name;
    if (typeof name !== 'string' || name.trim() === '') bad.push(`panel ${p.doc?.id ?? `#${p.i}`}: name=${JSON.stringify(name)}`);
  }
  assert.deepEqual(bad, [], `panels with a missing/blank name: ${bad.join(', ')}`);
});

test('every setting entry has a valid Style Settings type', () => {
  const bad = [];
  const seen = new Map();
  for (const p of panels()) {
    for (const entry of p.doc?.settings ?? []) {
      if (!entry) continue; // pinned separately below
      if (!entry.type) {
        bad.push(`panel ${p.doc.id}: entry "${entry.id ?? entry.title ?? '?'}" has no type`);
        continue;
      }
      seen.set(entry.type, (seen.get(entry.type) ?? 0) + 1);
      if (!VALID_TYPES.has(entry.type)) {
        bad.push(`panel ${p.doc.id}: entry "${entry.id ?? '?'}" has unknown type "${entry.type}"`);
      }
    }
  }
  assert.deepEqual(
    bad,
    [],
    `invalid setting types (valid: ${[...VALID_TYPES].join(', ')}):\n  ${bad.join('\n  ')}`,
  );
  assert.ok(seen.size >= 8, `only ${seen.size} distinct types seen — is the panel parse truncated?`);
});

test('every setting id is globally unique', () => {
  // A duplicate id makes two UI controls share one persisted state. This is the
  // single most damaging defect a Style Settings panel can have, because it looks
  // fine in the UI and only shows up as "toggling A also toggles B".
  const seen = new Map();
  for (const p of panels()) {
    for (const entry of p.doc?.settings ?? []) {
      if (!entry?.id) continue;
      const prev = seen.get(entry.id);
      if (prev) seen.set(entry.id, `${prev}, ${p.doc.id}`);
      else seen.set(entry.id, p.doc.id);
    }
  }
  const dupes = [...seen.entries()].filter(([, where]) => where.includes(','));
  assert.deepEqual(
    dupes,
    [],
    `duplicate setting ids (they will share one toggle):\n  ${dupes.map(([id, w]) => `${id} in ${w}`).join('\n  ')}`,
  );
  assert.ok(seen.size > 400, `expected >400 distinct setting ids, found ${seen.size}`);
});

test('every setting with an id also has a title', () => {
  const bad = [];
  for (const p of panels()) {
    for (const entry of p.doc?.settings ?? []) {
      if (!entry?.id) continue;
      if (typeof entry.title !== 'string' || entry.title.trim() === '') {
        bad.push(`${p.doc.id} / ${entry.id}`);
      }
    }
  }
  assert.deepEqual(bad, [], `settings with an id but no title (render as a blank row):\n  ${bad.join('\n  ')}`);
});

test('class-toggle ids are actually referenced by the stylesheet', () => {
  const toggles = [];
  for (const p of panels()) {
    for (const entry of p.doc?.settings ?? []) {
      if (entry?.type === 'class-toggle' && entry.id) toggles.push(entry.id);
    }
  }
  assert.ok(toggles.length > 100, `expected >100 class-toggles, found ${toggles.length}`);

  const refs = classToggleReferences(toggles);
  const dead = [...refs.entries()].filter(([, r]) => !r.asClass && !r.asDataId).map(([id]) => id);
  assert.deepEqual(
    dead,
    [],
    `class-toggles with no reference anywhere in theme.css (the switch does nothing):\n  ${dead.join('\n  ')}`,
  );

  // Informational: switches whose only reference is `[data-id="…"]` are panel
  // styling (the theme restyles the row itself), not behaviour. Those are fine.
  const dataIdOnly = [...refs.entries()].filter(([, r]) => !r.asClass && r.asDataId).map(([id]) => id);
  assert.ok(dataIdOnly.length < 30, `${dataIdOnly.length} toggles are styled by data-id only — expected <30`);
});

test('every variable-* setting maps onto a --custom-property the stylesheet reads', () => {
  // Style Settings turns `id: h1-color-dark` into `--h1-color-dark`. If the
  // stylesheet never reads that property, the control is a no-op — the UI moves
  // and nothing happens.
  //
  // Upstream had six of these (KNOWN-ISSUES #7). Their consumer CSS does not exist
  // anywhere in the stylesheet, so they were removed from the panels rather than
  // wired up: writing the missing rules would invent rendering that cannot be
  // reviewed from the repository. This test now requires the list to stay empty.
  const text = themeText();
  const missing = [];
  let checked = 0;
  for (const p of panels()) {
    for (const entry of p.doc?.settings ?? []) {
      if (!entry?.id || !entry.type?.startsWith('variable-')) continue;
      if (
        entry.type === 'variable-select' ||
        entry.type === 'variable-text' ||
        entry.type === 'variable-number' ||
        entry.type === 'variable-number-slider' ||
        entry.type === 'variable-textarea' ||
        entry.type === 'variable-color' ||
        entry.type === 'variable-themed-color'
      ) {
        checked++;
        const prop = `--${entry.id}`;
        if (!text.includes(prop)) missing.push(`${p.doc.id} / ${entry.id}`);
      }
    }
  }
  assert.ok(checked > 200, `expected >200 variable-* entries, checked ${checked}`);
  assert.deepEqual(
    missing.sort(),
    [],
    `variable-* settings whose custom property the stylesheet never reads:\n  ${missing.join('\n  ')}\n` +
      'A control that writes an unread property does nothing when the user changes it.\n' +
      'Either wire the property into the rule that should consume it, or remove the setting.',
  );
});

test('src/style-settings/*.yaml are in sync with theme.css', () => {
  // The panels exist twice: as YAML sources and inlined in theme.css. They must
  // agree, otherwise editing the source has no effect until someone re-runs the
  // build — or worse, the built file and the source drift apart.
  const files = settingsSourceFiles();
  assert.equal(files.length, 12, `expected 12 yaml sources, found ${files.length}`);

  const blocks = settingsBlocks();
  const fromCss = new Map(
    blocks.map((b) => {
      const doc = parsePanel(b.body).doc; // tolerant: #2 lives in this panel
      return [doc.id, b.body.replace(/\r\n/g, '\n').trim()];
    }),
  );

  const problems = [];
  for (const file of files) {
    const raw = stripSettingsFence(readFileSyncSafe(file));
    const doc = parsePanel(raw).doc;
    if (!doc?.id) {
      problems.push(`${rel(file)}: no id after stripping the fence`);
      continue;
    }
    const inCss = fromCss.get(doc.id);
    if (!inCss) {
      problems.push(`${rel(file)}: panel id "${doc.id}" does not appear in theme.css`);
      continue;
    }
    const fromSource = raw.replace(/\r\n/g, '\n').trim();
    if (normalizeWhitespace(fromSource) !== normalizeWhitespace(inCss)) {
      problems.push(`${rel(file)}: content differs from the copy embedded in theme.css`);
    }
  }
  assert.deepEqual(problems, [], `Style Settings sources drifted:\n  ${problems.join('\n  ')}`);
});

// ---------------------------------------------------------------------------
// previously-pinned upstream defects, now fixed (docs/KNOWN-ISSUES.md)
//
// These three tests used to assert that the defects *existed*, so that fixing one
// turned its pin red. They now assert the fixed state — the pins did their job.
// ---------------------------------------------------------------------------

test('every panel parses under strict YAML (#2, fixed)', () => {
  // Upstream, the `description` of `syntax-callouts-columns-metadata` opened a
  // double-quoted flow scalar whose continuation lines were NOT indented deeper
  // than the key. js-yaml (what Style Settings uses) is lenient and accepted it;
  // yaml@2 rejected the whole panel. The continuation lines were indented two
  // spaces deeper.
  //
  // Folding strips that extra indentation, so the *parsed value* must be exactly
  // what the lenient parse produced before. That equality is the proof the fix
  // changed no rendering — it is asserted below, not assumed.
  const strictFailures = panels().filter((p) => !p.strict);
  assert.deepEqual(
    strictFailures.map((p) => p.doc?.id ?? p.file),
    [],
    'panels that fail strict YAML parsing. Every panel must parse under a strict\n' +
      'parser, not just under the lenient one Style Settings happens to use.',
  );
});

test('the #2 scalar still folds to the same string it did before the fix', () => {
  const panel = panels().find((p) => p.doc?.id === 'V1-Willemstad-Ancillaries');
  assert.ok(panel, 'V1-Willemstad-Ancillaries panel not found');

  const entry = (panel.doc.settings ?? []).find((s) => s?.id === 'syntax-callouts-columns-metadata');
  assert.ok(entry, 'syntax-callouts-columns-metadata setting not found');

  // Exactly what js-yaml recovered from the malformed upstream YAML.
  assert.equal(
    entry.description,
    '>[!columns|metadata-class] > >> [!callout-class|metadata-class]',
    'the folded description changed. Re-indenting a flow scalar must not alter its\n' +
      'value; if it did, the #2 fix changed what the panel displays.',
  );
});

test('no panel contains a null settings entry (#3, fixed)', () => {
  // A bare `-` list marker with nothing after it parses to `null`. Style Settings
  // iterates `settings` unconditionally, so a null is at best a blank row and at
  // worst a crash on a plugin build that stops tolerating it. Upstream had three
  // (two trailing, one doubled mid-list in the editor panel).
  const withNulls = [];
  for (const p of panels()) {
    const nulls = (p.doc?.settings ?? []).filter((s) => s === null || s === undefined).length;
    if (nulls) withNulls.push(`${p.doc.id}: ${nulls}`);
  }
  assert.deepEqual(
    withNulls.sort(),
    [],
    `panels with null settings entries:\n  ${withNulls.join('\n  ')}\n` +
      'A stray "-" with no content parses to null. Delete it.',
  );
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readFileSyncSafe(p) {
  return readFileSync(p, 'utf8');
}

const normalizeWhitespace = (s) => s.replace(/[ \t]+$/gm, '').replace(/\r\n/g, '\n').trim();
