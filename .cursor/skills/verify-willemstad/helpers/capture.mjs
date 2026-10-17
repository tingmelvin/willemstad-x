#!/usr/bin/env node
/**
 * Drive one preview feature in an isolated headless Chrome via CDP.
 * Writes screenshots + computed-style JSON under VERIFY_EVIDENCE_DIR.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildChromeArgs } from "./chrome-args.mjs";
import { Cdp } from "./cdp.mjs";

const chrome = process.env.VERIFY_CHROME;
const baseUrl = process.env.VERIFY_BASE_URL;
const outDir = process.env.VERIFY_EVIDENCE_DIR;
const feature = process.env.VERIFY_FEATURE;
const extraQuery = process.env.VERIFY_EXTRA_QUERY || "";

if (!chrome || !baseUrl || !outDir || !feature) {
  console.error("capture.mjs: VERIFY_CHROME, VERIFY_BASE_URL, VERIFY_EVIDENCE_DIR, VERIFY_FEATURE required");
  process.exit(2);
}

const FEATURES = {
  reading: {
    path: "/preview/reading.html",
    variants: [
      { name: "dark", query: "mode=dark" },
      { name: "light", query: "mode=light" },
    ],
    assert(reports) {
      const dark = reports.dark;
      const light = reports.light;
      need(includes(dark.titleAfter, "Willemstad v"), "titlebar ::after must print Willemstad version", dark.titleAfter);
      need(includes(light.titleAfter, "Willemstad v"), "light titlebar ::after must print Willemstad version", light.titleAfter);
      need(notTransparent(dark.h1Bg), "dark H1 must have a theme background", dark.h1Bg);
      need(notTransparent(light.h1Bg), "light H1 must have a theme background", light.h1Bg);
      need(dark.bodyBg !== light.bodyBg, "light and dark body backgrounds must differ", {
        dark: dark.bodyBg,
        light: light.bodyBg,
      });
      need(dark.bodyClasses.includes("theme-dark"), "dark variant body class", dark.bodyClasses);
      need(light.bodyClasses.includes("theme-light"), "light variant body class", light.bodyClasses);
    },
  },
  callouts: {
    path: "/preview/callouts.html",
    variants: [{ name: "default", query: "mode=dark" }],
    assert(reports) {
      const r = reports.default;
      need(r.noteCallout, "note callout missing");
      need(Boolean(r.noteBorderLeft), "note callout border-left", r.noteBorderLeft);
      need(r.columnsDisplay === "flex", "columns callout-content must be display:flex", r.columnsDisplay);
      need(r.columnChildCount >= 2, "columns must contain at least two nested callouts", r.columnChildCount);
      need(r.infoboxFloat === "right", "infobox must float right by default", r.infoboxFloat);
      need(r.gridDisplay === "grid" || r.gridDisplay === "flex", "image grid layout", r.gridDisplay);
    },
  },
  cssclasses: {
    path: "/preview/cssclasses.html",
    variants: [{ name: "default", query: "mode=dark" }],
    assert(reports) {
      const r = reports.default;
      const latexPx = Number.parseFloat(r.latexFontSize);
      need(
        r.latexFontSize === "14pt" || latexPx >= 14,
        "latex reading font-size",
        r.latexFontSize,
      );
      need(r.latexAlign === "justify", "latex paragraphs are justified", r.latexAlign);
      need(r.cornellTextAlign === "justify", "cornell note body is justified", r.cornellTextAlign);
      need(r.cornellAsideFloat === "left", "cornell aside callout floats left", r.cornellAsideFloat);
    },
  },
  checkboxes: {
    path: "/preview/checkboxes.html",
    variants: [
      { name: "off", query: "mode=dark" },
      { name: "on", query: "mode=dark&opt=ssopt-acrs-enable" },
    ],
    assert(reports) {
      const on = reports.on;
      need(on.bodyClasses.includes("ssopt-acrs-enable"), "ACRS class missing on enabled variant", on.bodyClasses);
      need(Boolean(on.questionMask) && on.questionMask !== "none" && on.questionMask.trim() !== "", "question checkbox must get --icon-mask-image", on.questionMask);
      need(reports.off.questionMask !== on.questionMask, "enabling ACRS must change the question-task mask", {
        off: reports.off.questionMask,
        on: on.questionMask,
      });
    },
  },
  "focused-mode": {
    path: "/preview/focused-mode.html",
    variants: [
      { name: "normal", query: "mode=dark" },
      { name: "focused", query: "mode=dark&opt=ssopt-focused-mode" },
    ],
    assert(reports) {
      const n = reports.normal;
      const f = reports.focused;
      need(n.sidedockDisplay !== "none", "sidedock visible before focused mode", n.sidedockDisplay);
      need(n.titlebarDisplay !== "none", "titlebar visible before focused mode", n.titlebarDisplay);
      need(f.sidedockDisplay === "none", "focused mode hides .mod-sidedock", f.sidedockDisplay);
      need(f.titlebarDisplay === "none", "focused mode hides .titlebar", f.titlebarDisplay);
      need(f.statusDisplay === "none", "focused mode hides .status-bar", f.statusDisplay);
      need(f.ribbonDisplay === "none", "focused mode hides .side-dock-ribbon", f.ribbonDisplay);
    },
  },
};

function need(cond, message, extra) {
  if (!cond) {
    const err = new Error(message);
    err.extra = extra;
    throw err;
  }
}

function includes(value, needle) {
  return typeof value === "string" && value.includes(needle);
}

function notTransparent(bg) {
  if (!bg) return false;
  const t = bg.replace(/\s+/g, "").toLowerCase();
  return t !== "transparent" && t !== "rgba(0,0,0,0)" && t !== "rgba(0,0,0,0.0)";
}

function withQuery(path, query) {
  const q = [query, extraQuery].filter(Boolean).join("&");
  return q ? `${baseUrl}${path}?${q}` : `${baseUrl}${path}`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

async function waitForJson(url, timeoutMs) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = `status ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`DevTools never answered ${url} (${last})`);
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", (err) => reject(err));
  });
}

async function launchChrome() {
  const port = await freePort();
  const userData = join(tmpdir(), `verify-willemstad-chrome-${process.pid}-${port}`);
  mkdirSync(userData, { recursive: true });
  const child = spawn(
    chrome,
    buildChromeArgs({
      userData,
      port,
      allowNoSandbox: process.env.VERIFY_CHROME_NO_SANDBOX === "1",
    }),
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, 15000);
  const ws = await openWs(version.webSocketDebuggerUrl);
  return {
    child,
    userData,
    cdp: new Cdp(ws),
    ws,
    async close() {
      try { ws.close(); } catch { /* ignore */ }
      if (child.exitCode == null) {
        child.kill("SIGTERM");
        await new Promise((r) => setTimeout(r, 300));
        if (child.exitCode == null) child.kill("SIGKILL");
      }
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

async function attachPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  return { targetId, sessionId };
}

async function openUrl(cdp, sessionId, url) {
  const loaded = cdp.once("Page.loadEventFired", sessionId, 45000);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  const start = Date.now();
  let report = null;
  while (Date.now() - start < 15000) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `document.documentElement.dataset.verifyReady === "1" && window.__verifyCollect ? window.__verifyCollect() : null`,
      returnByValue: true,
    }, sessionId);
    report = result?.result?.value ?? null;
    if (report && report.ready) return report;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`boot.js never became ready at ${url}`);
}

async function screenshot(cdp, sessionId, file) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  writeFileSync(file, Buffer.from(data, "base64"));
}

async function dumpHtml(cdp, sessionId) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: "document.documentElement.outerHTML",
    returnByValue: true,
  }, sessionId);
  return result?.result?.value || "";
}

const spec = FEATURES[feature];
if (!spec) {
  console.error(`unknown feature ${feature}`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const reports = {};
const urls = {};
const browser = await launchChrome();

try {
  const { sessionId, targetId } = await attachPage(browser.cdp);
  for (const variant of spec.variants) {
    const url = withQuery(spec.path, variant.query);
    urls[variant.name] = url;
    const report = await openUrl(browser.cdp, sessionId, url);
    reports[variant.name] = report;
    await screenshot(browser.cdp, sessionId, join(outDir, `${variant.name}.png`));
    writeFileSync(join(outDir, `${variant.name}.report.json`), JSON.stringify(report, null, 2));
    writeFileSync(join(outDir, `${variant.name}.dom.html`), await dumpHtml(browser.cdp, sessionId));
  }
  await browser.cdp.send("Target.closeTarget", { targetId }).catch(() => {});
} catch (err) {
  await browser.close();
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({
    ok: false,
    feature,
    error: err.message,
    reports,
    urls,
  }, null, 2));
  console.error(`CAPTURE FAIL: ${err.message}`);
  process.exit(1);
}

await browser.close();

try {
  spec.assert(reports);
} catch (err) {
  const failure = {
    ok: false,
    feature,
    error: err.message,
    extra: err.extra ?? null,
    reports,
    urls,
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(failure, null, 2));
  console.error(`ASSERT FAIL: ${err.message}`);
  if (err.extra) console.error(JSON.stringify(err.extra, null, 2));
  process.exit(1);
}

writeFileSync(join(outDir, "summary.json"), JSON.stringify({ ok: true, feature, urls, reports }, null, 2));
console.log(JSON.stringify({ ok: true, feature, evidence: outDir, urls }, null, 2));
