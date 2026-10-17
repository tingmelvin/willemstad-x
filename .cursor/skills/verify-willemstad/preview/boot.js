/* Verification scaffolding. Applies ?mode= and ?opt= then writes #verify-report. */
(function () {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "light" ? "light" : "dark";
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add("theme-" + mode);
  (params.get("opt") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((cls) => document.body.classList.add(cls));

  function styleOf(sel, pseudo) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!el) return null;
    return getComputedStyle(el, pseudo || undefined);
  }

  function collect() {
    const title = styleOf(".titlebar-text", "::after");
    const h1 = styleOf('[data-type="markdown"] h1');
    const body = getComputedStyle(document.body);
    const note = styleOf('.callout[data-callout="note"]');
    const columns = styleOf('.callout[data-callout="columns"] > .callout-content');
    const columnRoot = document.querySelector('.callout[data-callout="columns"] > .callout-content');
    const infobox = styleOf('.callout[data-callout="infobox"]');
    const grid = styleOf('.callout[data-callout="images"][data-callout-metadata~="grid"] > .callout-content');
    const latex = styleOf(".latex.markdown-preview-view");
    const latexP = styleOf(".latex.markdown-preview-view p");
    const cornellP = styleOf(".cornell div.el-p");
    const cornellAside = styleOf('.cornell .callout[data-callout="aside"]');
    const question = document.querySelector('li[data-task="?"]');
    const questionStyle = question ? getComputedStyle(question) : null;
    const sidedock = styleOf(".mod-sidedock");
    const ribbon = styleOf(".side-dock-ribbon");
    const titlebar = styleOf(".titlebar");
    const status = styleOf(".status-bar");
    const viewHeader = styleOf(".view-header");

    return {
      href: location.href,
      ready: true,
      bodyClasses: [...document.body.classList],
      bodyBg: body.backgroundColor,
      bodyColor: body.color,
      titleAfter: title ? title.content : null,
      h1Color: h1 ? h1.color : null,
      h1Bg: h1 ? h1.backgroundColor : null,
      noteCallout: Boolean(note),
      noteBorderLeft: note ? note.borderLeft : null,
      noteBg: note ? note.backgroundColor : null,
      columnsDisplay: columns ? columns.display : null,
      columnChildCount: columnRoot
        ? columnRoot.querySelectorAll(":scope > .callout").length
        : 0,
      infoboxFloat: infobox ? infobox.float : null,
      infoboxWidth: infobox ? infobox.width : null,
      gridDisplay: grid ? grid.display : null,
      latexFontSize: latex ? latex.fontSize : null,
      latexAlign: latexP ? latexP.textAlign : null,
      cornellTextAlign: cornellP ? cornellP.textAlign : null,
      cornellAsideFloat: cornellAside ? cornellAside.float : null,
      questionMask: questionStyle ? questionStyle.getPropertyValue("--icon-mask-image") : null,
      sidedockDisplay: sidedock ? sidedock.display : null,
      ribbonDisplay: ribbon ? ribbon.display : null,
      titlebarDisplay: titlebar ? titlebar.display : null,
      statusDisplay: status ? status.display : null,
      viewHeaderDisplay: viewHeader ? viewHeader.display : null,
    };
  }

  window.__verifyCollect = collect;

  function writeReport(report) {
    let node = document.getElementById("verify-report");
    if (!node) {
      node = document.createElement("script");
      node.id = "verify-report";
      node.type = "application/json";
      document.body.appendChild(node);
    }
    node.textContent = JSON.stringify(report);
    document.documentElement.dataset.verifyReady = "1";
  }

  async function finish() {
    // Embedded @font-face in theme.css can leave document.fonts.ready pending.
    const fonts = document.fonts && document.fonts.ready
      ? Promise.race([
          document.fonts.ready,
          new Promise((r) => setTimeout(r, 1500)),
        ])
      : Promise.resolve();
    await fonts;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    writeReport(collect());
  }

  if (document.readyState === "complete") finish();
  else window.addEventListener("load", finish);
})();
