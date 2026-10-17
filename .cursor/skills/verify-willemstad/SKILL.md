---
name: verify-willemstad
description: Verify Willemstad (willemstad-x), an Obsidian CSS theme, by launching the isolated preview harness, driving reading/callout/cssclass/checkbox/focused-mode fixtures in Chrome, and capturing screenshots plus computed styles. Use when checking theme.css visual behavior, Style Settings class toggles, heading/callout regressions, or before shipping a theme.css change.
---

# Verify Willemstad

Willemstad is a compiled Obsidian theme, not a process. The user-facing surface is **Obsidian desktop** with `theme.css` selected under Settings → Appearance. This repo has no `package.json`, no Makefile, and no `start` script. `publish.css` is a stale Publish stylesheet (header still says v0.5.4) and is **not** the primary surface.

The command API is the root `justfile`. `just` / `just ci` / `just check` require python3, curl, node, and a checked-out `theme.css`; they run the complete static and unit-test gate without Chrome. Browser-driving commands require Chrome/Chromium and exit 2 with `try: just deps` when it is missing. `just deps` restores `theme.css` from this checkout; it does not apt-install Chromium.

There is no Obsidian binary in a typical agent environment, and attaching to a user's live vault would corrupt their session. Verification therefore drives an **isolated preview**: a loopback HTTP server that serves **this checkout's** `theme.css` onto static HTML that uses the real Obsidian class names the theme selects on (`theme-dark` / `theme-light`, `.workspace-leaf-content[data-type="markdown"]`, `.callout[data-callout=…]`, `.latex`, `.cornell`, `li[data-task]`, `body.ssopt-*`).

The preview is scaffolding. It proves the compiled CSS. It does **not** prove Style Settings' RealDisplay UI, the command palette, plugin chrome, or mobile Obsidian (officially unsupported).

Read `features/README.md` before driving. A proof that hits one convenient URL is incomplete when the map lists other entry points.

## Launch

From the repo root:

```bash
.cursor/skills/verify-willemstad/helpers/launch.sh
```

Ready when stdout contains `BASE_URL=http://127.0.0.1:47821` **and** `GET $BASE_URL/healthz` returns JSON with `"ok": true`. The server also prints `verify-willemstad ready on http://127.0.0.1:47821` to `$VERIFY_RUN_DIR/server.log` (default `/tmp/verify-willemstad/server.log`).

Defaults (override per isolated instance):

| Variable | Default | Meaning |
| --- | --- | --- |
| `VERIFY_BIND` | `127.0.0.1` | Loopback only. Non-loopback is refused. |
| `VERIFY_PORT` | `47821` | If occupied by something else, launch **exits**. Do not steal it. |
| `VERIFY_RUN_DIR` | `/tmp/verify-willemstad` | pid + `meta.env` for this instance |
| `VERIFY_EVIDENCE_DIR` | `/tmp/verify-willemstad/evidence` | Proof artifacts. Cleanup never deletes this. |
| `VERIFY_CHROME` | first of `google-chrome-stable`, `google-chrome`, `chromium` | Driver binary. Missing → `try: just deps`. |
| `VERIFY_CHROME_NO_SANDBOX` | unset | Set to `1` only in a constrained container that cannot start Chrome's sandbox. Local verification keeps the sandbox enabled. |

Two instances may run side by side only with **different** `VERIFY_PORT` **and** `VERIFY_RUN_DIR`. Never point this harness at a running Obsidian vault, and never kill by process name (`obsidian`, `chrome`, `python`).

Teardown:

```bash
.cursor/skills/verify-willemstad/helpers/cleanup.sh
```

That sends SIGTERM (then SIGKILL) only when the pid, process start time, and `serve.py` command match the identity recorded at launch. A live mismatched pid is refused.

## Doctor

Run this first whenever anything looks off:

```bash
.cursor/skills/verify-willemstad/helpers/doctor.sh
```

It is read-only. It answers "is this instance ours and the CSS from this checkout?":

- pid in `$VERIFY_RUN_DIR/server.pid` is alive
- `/healthz` `version` equals `manifest.json` `version` and the `Willemstad \| v…` banner in the first 8 KB of `theme.css` (currently **1.11.1**)
- `/theme.css` is served and its header contains that same banner
- `/preview/reading.html` and `/preview/callouts.html` return 200
- bind is loopback; if `ss` is present, the port's listener pid matches

If doctor fails: cleanup, then launch again. Do not keep driving a shared or mismatched instance.

## Drive

Harness: **preview HTTP + headless Chrome** (`helpers/capture.mjs`).

```bash
.cursor/skills/verify-willemstad/helpers/drive.sh reading
.cursor/skills/verify-willemstad/helpers/drive.sh callouts
.cursor/skills/verify-willemstad/helpers/drive.sh cssclasses
.cursor/skills/verify-willemstad/helpers/drive.sh checkboxes
.cursor/skills/verify-willemstad/helpers/drive.sh focused-mode
```

`drive.sh` runs doctor first, then opens each mapped variant in an isolated, sandboxed headless Chrome (own `--user-data-dir` + DevTools port — never the user's profile). It waits for `boot.js` (`dataset.verifyReady` + `window.__verifyCollect`), writes a 1440×900 screenshot, and asserts computed styles. Use `VERIFY_CHROME_NO_SANDBOX=1` only when a constrained container cannot start Chrome otherwise.

Stable handles (from this theme, not coordinates):

| What | Selector / query |
| --- | --- |
| Color mode | `body.theme-dark` / `body.theme-light` via `?mode=dark` or `?mode=light` |
| Style Settings class-toggles | `?opt=ssopt-focused-mode`, `?opt=ssopt-acrs-enable`, `?opt=ssopt-callout-standard` (comma-separate to combine) |
| Version in titlebar | `div.titlebar-text::after` content contains `Willemstad v1.11.1` (`theme.css` `AA01-1-1`) |
| Coloured headers | `body:not(.ssopt-no-coloured-headers) .workspace-leaf-content[data-type="markdown"] h1` — `background-color: var(--col-h1-bg)` |
| Note callout | `.callout[data-callout="note"]` |
| Columns | `.callout[data-callout="columns"] > .callout-content` is `display: flex` |
| Infobox | `.callout[data-callout="infobox"]` `float: right` |
| Image grid | `.callout[data-callout="images"][data-callout-metadata*="grid"] > .callout-content` is `display: grid` |
| LaTeX CSSClass | `.latex.markdown-preview-view` (`cssclass: latex`) |
| Cornell CSSClass | `.cornell` plus `.callout[data-callout="aside"]` (`cssclass: cornell`) |
| ACRS | `body.ssopt-acrs-enable li[data-task="?"]` `--icon-mask-image` |
| Focused mode | `body.ssopt-focused-mode` hides `.mod-sidedock`, `.side-dock-ribbon`, `.titlebar`, `.status-bar`, `.view-header` |

Do not verify by editing CSS variables in the console or by hitting a test-only endpoint. The only HTTP endpoints are `/healthz`, `/theme.css`, `/manifest.json`, and `/preview/*`.

## Evidence

Proof lives under `$VERIFY_EVIDENCE_DIR/<UTC-stamp>-<feature>.<unique-suffix>/` and **survives cleanup**. The directory is allocated atomically so parallel or rapid repeat runs cannot overwrite one another. A passing drive writes:

- `<variant>.png` — the painted preview after `theme.css` applied (action + result: dark and light, or off/on toggle)
- `<variant>.report.json` — computed styles from `window.__verifyCollect()` after load
- `<variant>.dom.html` — serialized DOM after the probe ran
- `summary.json` — `{ "ok": true, "feature", "urls", "reports" }`

Standards:

- Exercise the user path: reading markup, callout types a user types as `> [!note]`, CSSClasses a user puts in frontmatter, ACRS task characters, Focused Mode as a Style Settings / command class-toggle.
- Capture **before and after** for toggles (light/dark, ACRS off/on, focused off/on), not only the final screen.
- Side effects here are CSS, not database rows. The observable side effect is computed style + pixels. Confirm `/theme.css` bytes and version in doctor so you did not paint a cached or foreign file.
- Mocks: only the workspace **layout** in `preview/harness.css` (Obsidian `app.css` is not in this repo). The paint must come from `/theme.css`.
- This is not a dry-run that still talks to Obsidian's servers. `launch.sh` binds loopback and serves local files only. Confirm `healthz.bind` is `127.0.0.1`.

If `summary.json` has `"ok": false`, treat the feature as unproven. Cleanup, fix, relaunch, drive again.

## Cleanup

```bash
.cursor/skills/verify-willemstad/helpers/cleanup.sh
```

Kills only the recorded server pid after its start time and command match the launch metadata. Refuses a live mismatched pid. Removes `$VERIFY_RUN_DIR/server.pid` and `meta.env` after a successful or already-stopped cleanup. Does **not** delete `$VERIFY_EVIDENCE_DIR`. After cleanup, `ls` the evidence directory from the drive stdout line `EVIDENCE_DIR=...` and confirm the screenshots and `summary.json` are still there.

## Helpers

All executable; invoke from repo root (or any cwd — they locate the repo by walking up to `theme.css` + `manifest.json`).

| Script | What it does |
| --- | --- |
| `helpers/deps.sh` | `--check` for `just ci`; default restores `theme.css` and reports missing Chrome |
| `helpers/launch.sh` | Starts `helpers/serve.py` on loopback; writes pid/meta; prints `BASE_URL=` |
| `helpers/doctor.sh` | Read-only health + version identity |
| `helpers/drive.sh <feature>` | Doctor, then Chrome capture + assertions |
| `helpers/cleanup.sh` | Stop the pid we started |
| `helpers/serve.py` | HTTP: `/healthz`, `/theme.css`, `/preview/*` |
| `helpers/capture.mjs` | Headless Chrome screenshots + `#verify-report` assertions |
| `helpers/chrome-args.mjs` | Builds sandboxed Chrome arguments with explicit container opt-out |
| `helpers/cdp.mjs` | CDP request/event lifecycle with bounded, cleared timers |
| `helpers/lib.sh` | Shared paths; sourced by the shell scripts, not run directly |

`preview/harness.css` and `preview/boot.js` are scaffolding. `boot.js` applies `?mode=` / `?opt=` and writes `<script type="application/json" id="verify-report">`.

## Isolate

Refuse to double-drive a shared instance. If port `47821` is taken by a pid that is not in our run dir, stop and pick another `VERIFY_PORT` + `VERIFY_RUN_DIR`. Do not inject CSS into someone's Obsidian window.
