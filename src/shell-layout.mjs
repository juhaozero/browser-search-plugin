import { findLayoutShell } from "./layout-dom.mjs";
import { ASIDE_GAP, ASIDE_IDS, ASIDE_MAX, CARD_COLUMN_GAP, CARD_GAP, CENTERED_STYLE_PROPS, DOUBLE_SHELL_MAX, RELAYOUT_FLAG, SIDE_GAP, SINGLE_SHELL_MAX, WRAPPING_SHELL_IDS } from "./layout-constants.mjs";
import { collectHeaderBands, placeBingResultCount, placeNavBands, refreshChromeLayout, sanitizeNavChrome } from "./nav-chrome.mjs";
import { clearHorizontalMargin, isDisplayed, isElement, measureViewport, placeAtViewportCenter, rectOf, stampCentered } from "./layout-dom.mjs";
import { hideBingSideRails, stackBingFactRows } from "./bing-layout.mjs";
import { alignGoogleSearchField, restoreGoogleSearchField } from "./search-field.mjs";

/**
 * @param {HTMLElement} box
 * @param {number | undefined} viewportWidth
 */
function alignSingleCenter(box, viewportWidth) {
  alignResultsBox(box, viewportWidth);
}

/**
 * @param {HTMLElement} box
 * @param {number | undefined} viewportWidth
 */
function alignResultsBox(box, viewportWidth) {
  const document = box.ownerDocument;
  const mode = box.dataset.mode;
  if (mode !== "single-center" && mode !== "double") {
    clearCenteredLayout(document);
    return;
  }
  if (!viewportWidth || viewportWidth <= 0) return;

  const metrics = layoutMetrics(document, mode, viewportWidth);
  const root = document.documentElement;
  // 壳宽/模式未变时跳过整页清样式，但仍刷新顶栏+导航（谷歌搜索框/标签常晚到或被原生改写）
  if (
    root.dataset.bspShellWidth === String(metrics.shellWidth)
    && root.dataset.bspColumnMode === mode
    && document.querySelector("[data-bsp-centered]")
    && root.dataset.bspShellStructure === shellStructure(document)
    && root.style.getPropertyValue("--bsp-main-width") === `${metrics.mainWidth}px`
  ) {
    refreshChromeLayout(document, metrics);
    return;
  }

  root.dataset[RELAYOUT_FLAG] = "1";
  try {
    clearCenteredLayout(document);
    applyShellLayout(document, box, metrics);
    root.dataset.bspShellWidth = String(metrics.shellWidth);
    root.dataset.bspColumnMode = mode;
    root.dataset.bspShellStructure = shellStructure(document);
    root.style.setProperty("--bsp-shell-width", `${metrics.shellWidth}px`);
    root.style.setProperty("--bsp-main-width", `${metrics.mainWidth}px`);
    root.style.setProperty("--bsp-target-left", `${metrics.targetLeft}px`);
  } finally {
    delete root.dataset[RELAYOUT_FLAG];
  }
}

// AI/侧栏可能在总宽不变时插入、隐藏或替换；不能只按壳宽缓存布局。
const shellNodes = new WeakMap();

let shellNodeId = 0;

function shellStructure(document) {
  const shell = findLayoutShell(document);
  if (!shell) return "";
  return [...shell.children].map((child) => {
    if (!shellNodes.has(child)) shellNodes.set(child, ++shellNodeId);
    return `${shellNodes.get(child)}:${isDisplayed(child)}`;
  }).join("|");
}

/**
 * @param {string} mode
 * @param {number} viewportWidth
 */
function contentWidth(mode, viewportWidth) {
  const target = mode === "double" ? DOUBLE_SHELL_MAX : SINGLE_SHELL_MAX;
  const usable = Math.max(0, viewportWidth - SIDE_GAP * 2);
  return Math.min(target, usable);
}

/**
 * @param {Document} document
 * @param {string} mode
 * @param {number} viewportWidth
 */
function layoutMetrics(document, mode, viewportWidth) {
  const maxShell = Math.max(0, viewportWidth - SIDE_GAP * 2);
  const aside = visibleAside(document);
  const shell = findLayoutShell(document);
  const asideInShell = Boolean(aside && shell?.contains(aside));
  const asideWidth = asideInShell ? measureAsideWidth(aside, maxShell) : 0;
  // 双列至少留出两卡宽度，避免右栏把主列挤到不可读
  const minMain = mode === "double" ? 640 : 320;

  if (asideWidth > 0) {
    // 窄屏将知识卡放到结果下方，避免 640px 主列 + 侧栏超过壳宽。
    if (maxShell < minMain + ASIDE_GAP + asideWidth) {
      return {
        mainWidth: maxShell, asideWidth: Math.min(asideWidth, maxShell),
        shellWidth: maxShell, targetLeft: Math.max(0, Math.round((viewportWidth - maxShell) / 2)),
        gap: ASIDE_GAP, hasAside: true, aside, asideInShell: true,
        stackAside: true, viewportWidth,
      };
    }
    const mainWidth = Math.max(
      minMain,
      Math.min(
        contentWidth(mode, viewportWidth),
        maxShell - ASIDE_GAP - asideWidth,
      ),
    );
    const shellWidth = Math.min(maxShell, mainWidth + ASIDE_GAP + asideWidth);
    return {
      mainWidth,
      asideWidth: Math.min(asideWidth, Math.max(0, shellWidth - mainWidth - ASIDE_GAP)),
      shellWidth,
      targetLeft: Math.max(SIDE_GAP, Math.round((viewportWidth - shellWidth) / 2)),
      gap: ASIDE_GAP,
      hasAside: true,
      aside,
      asideInShell: true,
      viewportWidth,
    };
  }

  const mainWidth = Math.min(contentWidth(mode, viewportWidth), maxShell);
  return {
    mainWidth,
    asideWidth: 0,
    shellWidth: mainWidth,
    targetLeft: Math.max(SIDE_GAP, Math.round((viewportWidth - mainWidth) / 2)),
    gap: 0,
    hasAside: false,
    aside: null,
    asideInShell: false,
    viewportWidth,
  };
}

/**
 * @param {Document} document
 * @param {HTMLElement} box
 * @param {ReturnType<typeof layoutMetrics>} metrics
 */
function applyShellLayout(document, box, metrics) {
  const mode = box.dataset.mode ?? "";
  const rcnt = findLayoutShell(document);
  const column = findResultColumn(document, rcnt);
  hideBingSideRails(document, rcnt, column);
  const asideInShell = Boolean(metrics.aside && rcnt?.contains(metrics.aside));
  const needsWrap = Boolean(
    rcnt && WRAPPING_SHELL_IDS.has(rcnt.id) && column && hasLeadingShellSibling(rcnt, column),
  );

  neutralizePageLeftBias(document);
  // 祖先拉满视口，否则子级 margin:auto 只在偏窄/偏左的包含块里「居中」，视觉上就会偏右
  expandLayoutRoots(document);

  /** @type {Set<HTMLElement>} */
  const placed = new Set();
  if (rcnt && (asideInShell || needsWrap)) {
    placeAtViewportCenter(rcnt, metrics.shellWidth, metrics.targetLeft);
    placed.add(rcnt);
    rcnt.style.setProperty("display", "flex", "important");
    rcnt.style.setProperty("flex-direction", "row", "important");
    rcnt.style.setProperty("align-items", "flex-start", "important");
    rcnt.style.setProperty("gap", `${metrics.gap}px`, "important");
    const wrap = needsWrap ? spanLeadingShellRows(rcnt, column) : false;
    rcnt.style.setProperty("flex-wrap", wrap || metrics.stackAside ? "wrap" : "nowrap", "important");

    if (column) {
      stampCentered(column);
      column.style.setProperty("display", "block", "important");
      // basis=0 且 gap=0 时，通栏 AI 后仍能塞入一个零宽结果列；用主列预算保证换行。
      column.style.setProperty("flex", metrics.stackAside ? "0 0 100%" : `1 1 ${metrics.mainWidth}px`, "important");
      column.style.setProperty("min-width", "0", "important");
      column.style.setProperty("max-width", `${metrics.mainWidth}px`, "important");
      column.style.setProperty("width", "auto", "important");
      column.style.setProperty("padding", "0", "important");
      column.style.setProperty("float", "none", "important");
      clearHorizontalMargin(column);
      // 新版必应列是 main：内层结果列表拉满主列
      const nestedResults = column.id === "b_results" ? null : column.querySelector("#b_results");
      if (nestedResults && isElement(nestedResults)) {
        stampCentered(nestedResults);
        nestedResults.style.setProperty("display", "block", "important");
        nestedResults.style.setProperty("width", "100%", "important");
        nestedResults.style.setProperty("max-width", "100%", "important");
        clearHorizontalMargin(nestedResults);
        nestedResults.style.setProperty("padding", "0", "important");
        nestedResults.style.setProperty("float", "none", "important");
      }
    }

    if (asideInShell && metrics.aside) {
      placeShellAside(rcnt, metrics.aside, metrics.asideWidth);
    }
  } else if (column) {
    // 整页容器多为 grid：会把列宽夹到旧列宽（并因此整体偏右），恢复成普通块让壳真居中
    if (rcnt && !hasVisibleSibling(rcnt, column)) {
      stampCentered(rcnt);
      rcnt.style.setProperty("display", "block", "important");
      rcnt.style.setProperty("grid-template-columns", "none", "important");
      rcnt.style.setProperty("width", "100%", "important");
      rcnt.style.setProperty("max-width", "100%", "important");
      rcnt.style.setProperty("margin-left", "0", "important");
      rcnt.style.setProperty("margin-right", "0", "important");
    }
    // 必应无右栏：外壳定宽居中，结果列只限宽不另写 margin
    if (rcnt?.contains(column)) {
      placeAtViewportCenter(rcnt, metrics.shellWidth, metrics.targetLeft);
      placed.add(rcnt);
      stampCentered(column);
      column.style.setProperty("display", "block", "important");
      column.style.setProperty("max-width", `${metrics.mainWidth}px`, "important");
      column.style.setProperty("width", "100%", "important");
      clearHorizontalMargin(column);
      column.style.setProperty("float", "none", "important");
      const nestedResults = column.id === "b_results" ? null : column.querySelector("#b_results");
      if (nestedResults && isElement(nestedResults)) {
        stampCentered(nestedResults);
        nestedResults.style.setProperty("display", "block", "important");
        nestedResults.style.setProperty("width", "100%", "important");
        nestedResults.style.setProperty("max-width", "100%", "important");
        clearHorizontalMargin(nestedResults);
        nestedResults.style.setProperty("float", "none", "important");
      }
    } else {
      placeAtViewportCenter(column, metrics.shellWidth, metrics.targetLeft);
      column.style.setProperty("display", "block", "important");
      placed.add(column);
    }
  }

  // 搜索框 / 顶栏 / 导航 / 结果列：统一用同一 targetLeft，保证落在视口正中间
  for (const el of collectHeaderBands(document)) {
    if (!el || placed.has(el)) continue;
    if ([...placed].some((other) => other.contains(el) || el.contains(other))) {
      if (el.id === "b_tween") placeBingResultCount(el, metrics, placed);
      continue;
    }

    // #b_tween：结果计数 + 站点图标。不能改 position / width，否则图标和计数会压到第一条结果上。
    if (el.id === "b_tween") {
      placeBingResultCount(el, metrics, placed);
      placed.add(el);
      continue;
    }

    placeAtViewportCenter(el, metrics.shellWidth, metrics.targetLeft);
    placed.add(el);
  }
  placeNavBands(document, metrics.shellWidth, metrics.targetLeft, placed);
  sanitizeNavChrome(document);
  alignGoogleSearchField(document, metrics);

  box.style.setProperty("width", "100%", "important");
  box.style.setProperty("max-width", "100%", "important");
  box.style.minWidth = "0";
  box.style.marginLeft = "0";
  box.style.marginRight = "0";
  box.style.paddingLeft = "0";
  box.style.paddingRight = "0";
  box.style.boxSizing = "border-box";
  stackBingFactRows(box);
  if (mode === "double") {
    box.style.setProperty("display", "grid", "important");
    box.style.setProperty("grid-template-columns", "var(--bsp-grid-columns, minmax(0, 1fr) minmax(0, 1fr))", "important");
    box.style.setProperty("column-gap", `${CARD_COLUMN_GAP}px`, "important");
    box.style.setProperty("row-gap", `${CARD_GAP}px`, "important");
  }
}



/**
 * @param {Document} document
 * @param {HTMLElement | null} shell
 * @returns {HTMLElement | null}
 */
function findResultColumn(document, shell) {
  const google = document.getElementById("center_col");
  if (google) return google;
  // 新版必应壳是 #b_content：flex 子项必须是 main（内含 #b_results），不能是嵌套的 ol
  if (shell?.id === "b_content") {
    const main = shell.querySelector(":scope > main");
    if (main && isElement(main)) return main;
  }
  return document.getElementById("b_results")
    ?? boxParentFallback(document);
}

/**
 * @param {Document} document
 */
function boxParentFallback(document) {
  return document.getElementById("bsp-results")?.parentElement ?? null;
}

/**
 * @param {HTMLElement} shell
 * @param {HTMLElement} column
 */
function hasLeadingShellSibling(shell, column) {
  for (const child of shell.children) {
    if (child === column) return false;
    if (!isElement(child) || !isDisplayed(child) || child.contains(column)) continue;
    if (child.id === "rhs" || child.querySelector("#rhs")) continue;
    if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
    return true;
  }
  return false;
}

/**
 * 结果列之前的可见兄弟（必应 #b_topw 通栏答案）独占一行，结果列与侧栏排在下一行。
 * @param {HTMLElement} shell
 * @param {HTMLElement} column
 * @returns {boolean} 是否存在需要独占一行的兄弟
 */
function spanLeadingShellRows(shell, column) {
  let spanned = false;
  for (const child of shell.children) {
    if (child === column) break;
    if (!isElement(child) || !isDisplayed(child) || child.contains(column)) continue;
    if (child.id === "rhs" || child.querySelector("#rhs")) continue;
    if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
    stampCentered(child);
    child.style.setProperty("flex", "0 0 100%", "important");
    child.style.setProperty("width", "100%", "important");
    child.style.setProperty("max-width", "100%", "important");
    child.style.setProperty("margin-left", "0", "important");
    child.style.setProperty("margin-right", "0", "important");
    spanned = true;
  }
  return spanned;
}

/**
 * 侧栏可能套在 aside 里：定宽写到壳的直接子级，内层拉满。
 * @param {HTMLElement} shell
 * @param {HTMLElement} aside
 * @param {number} widthPx
 */
function placeShellAside(shell, aside, widthPx) {
  let item = aside;
  while (item.parentElement && item.parentElement !== shell) item = item.parentElement;
  if (item.parentElement !== shell) item = aside;
  stampCentered(item);
  item.style.setProperty("display", "block", "important");
  item.style.setProperty("flex", `0 0 ${widthPx}px`, "important");
  item.style.setProperty("width", `${widthPx}px`, "important");
  item.style.setProperty("max-width", `${widthPx}px`, "important");
  item.style.setProperty("min-width", "0", "important");
  item.style.setProperty("margin", "0", "important");
  item.style.setProperty("float", "none", "important");
  item.style.setProperty("position", "relative", "important");
  if (item === aside) return;
  stampCentered(aside);
  aside.style.setProperty("width", "100%", "important");
  aside.style.setProperty("max-width", "100%", "important");
  aside.style.setProperty("margin-left", "0", "important");
  aside.style.setProperty("padding-left", "0", "important");
  aside.style.setProperty("box-sizing", "border-box", "important");
}

/**
 * 清掉搜索引擎常见左侧固定 padding（不定宽，避免祖先与子级双重偏移）。
 * @param {Document} document
 */
function neutralizePageLeftBias(document) {
  for (const id of [
    "cnt", "center_col", "rcnt", "appbar", "main",
    "hdtb", "slim_appbar", "b_content",
  ]) {
    const el = document.getElementById(id);
    if (!el) continue;
    stampCentered(el);
    el.style.setProperty("padding-left", "0", "important");
    el.style.setProperty("padding-right", "0", "important");
    el.style.setProperty("left", "auto", "important");
    el.style.setProperty("right", "auto", "important");
    el.style.setProperty("transform", "none", "important");
  }
}

/**
 * 把整页骨架拉满视口，避免在偏左的窄包含块里「居中」导致整体偏右。
 * @param {Document} document
 */
function expandLayoutRoots(document) {
  const roots = ["main", "cnt", "rcnt"];
  const bingMain = document.querySelector("#b_content > main");
  if (bingMain && isElement(bingMain)) {
    stampCentered(bingMain);
    bingMain.style.setProperty("display", "block", "important");
    roots.push(bingMain);
  }
  for (const idOrEl of roots) {
    const el = typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
    if (!el) continue;
    stampCentered(el);
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("min-width", "0", "important");
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("margin-right", "0", "important");
    el.style.setProperty("padding-left", "0", "important");
    el.style.setProperty("padding-right", "0", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
  }
}

/**
 * @param {Document} document
 */
function clearCenteredLayout(document) {
  restoreGoogleSearchField(document);
  for (const el of document.querySelectorAll("[data-bsp-centered]")) {
    for (const prop of CENTERED_STYLE_PROPS) {
      el.style.removeProperty(prop);
    }
    delete el.dataset.bspCentered;
    delete el.dataset.bspPlaced;
    delete el.dataset.bspNavTrailing;
    delete el.dataset.bspNavInner;
    delete el.dataset.bspNavSpacer;
    delete el.dataset.bspNavScrollkill;
  }
  const root = document.documentElement;
  delete root.dataset.bspShellStructure;
  root.style.removeProperty("--bsp-shell-width");
  root.style.removeProperty("--bsp-main-width");
  root.style.removeProperty("--bsp-target-left");
  const box = document.getElementById("bsp-results");
  if (!box) return;
  box.style.width = "";
  box.style.maxWidth = "";
  box.style.minWidth = "";
  box.style.marginLeft = "";
  box.style.marginRight = "";
  box.style.paddingLeft = "";
  box.style.paddingRight = "";
  box.style.boxSizing = "";
  box.style.removeProperty("display");
  box.style.removeProperty("grid-template-columns");
  box.style.removeProperty("column-gap");
  box.style.removeProperty("row-gap");
  box.style.removeProperty("gap");
}

/**
 * @param {Document} document
 * @param {{ viewportWidth?: number, parentLeft?: number }} layout
 */
function realign(document, layout) {
  const box = document.getElementById("bsp-results");
  if (!box) {
    clearCenteredLayout(document);
    return;
  }
  // Apply scoped result-path CSS before measuring the search-field target.
  document.documentElement.dataset.bspActive = "1";
  alignResultsBox(box, layout.viewportWidth ?? measureViewport());
}

function visibleAside(document) {
  // 必应右栏（旧版 #b_context / 新版 aside）直接屏蔽，不参与布局计算，
  // 由 CSS 负责隐藏，主列独占壳宽居中，与谷歌行为一致。
  if (document.getElementById("b_results") || document.getElementById("b_header")) {
    return null;
  }
  for (const id of ASIDE_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (!isDisplayed(el)) continue;
    if ((el.children?.length ?? 0) === 0 && measureAsideWidth(el, 9999) < 80) continue;
    return el;
  }
  return null;
}

/**
 * @param {HTMLElement} el
 * @param {number} maxShell
 */
function measureAsideWidth(el, maxShell) {
  let width = ASIDE_MAX;
  if (typeof el.getBoundingClientRect === "function") {
    const measured = el.getBoundingClientRect().width;
    if (measured >= 80) width = measured;
  }
  const view = el.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    const computed = Number.parseFloat(view.getComputedStyle(el).width);
    if (Number.isFinite(computed) && computed >= 80) width = computed;
  }
  const capped = Math.min(ASIDE_MAX, Math.round(width));
  const maxAside = Math.max(240, maxShell - 480 - ASIDE_GAP);
  return Math.min(capped, maxAside);
}

/**
 * 整页容器里是否还有可见的兄弟列（侧栏）：有就不该把它降级成块布局。
 * @param {HTMLElement} container
 * @param {HTMLElement | null} column
 */
function hasVisibleSibling(container, column) {
  for (const child of container.children) {
    if (child === column) continue;
    if (!isElement(child)) continue;
    if (!isDisplayed(child)) continue;
    if (rectOf(child).width >= 80) return true;
  }
  return false;
}

export { alignResultsBox, alignSingleCenter, clearCenteredLayout, contentWidth, layoutMetrics, realign };
