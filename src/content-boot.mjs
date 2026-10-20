import { createSearchSession, isDesktopWebSearch } from "./search-session.mjs";
import { createAutoPager, fetchHtmlDocument } from "./auto-page.mjs";
import { DEFAULT_PREFS, createChromePrefsStore } from "./preferences.mjs";
import { isExtensionContextValid } from "./content-lifecycle.mjs";
import { endLayoutGate } from "./layout-gate.mjs";

export { DEFAULT_PREFS };

/** 单列壳宽：改卡片列宽主要调这里（同步改 content.css 里 --bsp-single-max） */
const SINGLE_SHELL_MAX = 1100;
/** 双列壳宽：两卡总宽（同步改 content.css 里 --bsp-double-max） */
const DOUBLE_SHELL_MAX = 1320;
const SIDE_GAP = 32;
const ASIDE_GAP = 28;
const ASIDE_MAX = 360;
/** 结果卡片间距（同步 CSS --bsp-card-gap / --bsp-card-column-gap） */
const CARD_GAP = 22;
const CARD_COLUMN_GAP = 24;

const CENTERED_STYLE_PROPS = [
  "width",
  "max-width",
  "min-width",
  "margin-left",
  "margin-right",
  "padding-left",
  "padding-right",
  "padding-inline-start",
  "margin-inline-start",
  "float",
  "left",
  "right",
  "transform",
  "display",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-self",
  "text-align",
  "gap",
  "flex",
  "flex-shrink",
  "flex-grow",
  "position",
  "box-sizing",
  "top",
  "bottom",
  "grid-template-columns",
  "grid-column",
  "justify-self",
  "margin-top",
  "margin-bottom",
  "clear",
  "height",
  "max-height",
  "overflow",
];

const ASIDE_IDS = ["rhs", "b_context"];
/** 结果列外壳：谷歌 #rcnt；必应旧版 #b_mcw；新版无 mcw 时用 #b_content */
const LAYOUT_SHELL_IDS = ["rcnt", "b_mcw", "b_content"];
/** 顶部 AI/通栏答案独占一行，结果列与侧栏排在下一行 */
const WRAPPING_SHELL_IDS = new Set(["rcnt", "b_mcw", "b_content"]);
const RELAYOUT_FLAG = "bspRelayout";
/** 自身 DOM 改写期间屏蔽 MutationObserver，避免 refresh/搬移结果节点形成反馈环 */
const DOM_MUTE_FLAG = "bspDomMute";

const RESULTS_WATCH_IDS = ["rso", "search", "center_col", "b_results", "b_content"];
/** 顶栏/导航晚到时也要触发 realign（结果区 observer 看不到） */
const NAV_WATCH_IDS = ["searchform", "sfcnt", "sf", "appbar", "slim_appbar", "hdtb", "b_header"];
/** 现代谷歌导航标签的稳定标记（jsname 在多次改版中保持不变） */
const NAV_TAB_JSNAME = "pxBnId";
/** 必应顶栏导航：稳定结构，不依赖文案兜底 */
const BING_NAV_TAB_SELECTOR = "nav.b_scopebar > ul > li > a";
/** 导航标签文本兜底：只在已知导航容器内匹配，避免误伤正文里同名的链接 */
const NAV_TAB_LABELS = new Set([
  "全部", "图片", "视频", "新闻", "短视频", "网页", "图书", "地图", "购物", "财经", "更多", "工具",
  "All", "Images", "Videos", "News", "Books", "Maps", "Shopping", "Finance", "More", "Tools",
]);
/** 导航带最大高度：超过说明上爬过头，命中的是整页容器而非单行导航 */
const NAV_BAND_MAX_HEIGHT = 96;
/** 上爬禁止越过的整页容器 */
const NAV_BAND_STOP_IDS = new Set([
  "cnt", "main", "rcnt", "center_col", "search", "gsr", "b_content",
  // 已由 placeHeader 定壳的顶栏：导航带停在其内部，拉满宿主即可与搜索栏对齐
  "appbar", "slim_appbar", "searchform", "sfcnt", "sf", "b_header",
]);

/**
 * @param {Document} document
 * @param {string} url
 * @param {{ viewportWidth?: number, parentLeft?: number }} [layout]
 * @param {{
 *   prefs?: { columnMode?: string, autoPage?: boolean },
 *   prefsStore?: { load: () => Promise<object>, save?: Function, subscribe?: Function },
 *   fetchDocument?: (url: string) => Promise<Document>,
 *   attachScroll?: boolean,
 *   watchDom?: boolean,
 * }} [deps]
 */
export async function bootSearchPage(document, url, layout = {}, deps = {}) {
  if (!isDesktopWebSearch(url)) return null;
  const store = deps.prefsStore
    ?? (typeof chrome !== "undefined" && chrome?.storage
      ? createChromePrefsStore(chrome.storage)
      : null);
  const prefs = normalizeBootPrefs(deps.prefs ?? (store ? await store.load() : DEFAULT_PREFS));
  const session = createSearchSession(document, url, prefs);
  realign(document, layout);
  markActive(document, session.engine);
  // 布局已落到自定义列模式（或 original），允许显示结果区
  endLayoutGate(document);

  let watcher = {
    dispose() {},
    runMuted(fn) {
      return fn();
    },
  };

  const pager = createAutoPager({
    document,
    session,
    url,
    enabled: prefs.autoPage,
    fetchDocument: deps.fetchDocument ?? fetchHtmlDocument,
    mutate: (fn) => watcher.runMuted(fn),
  });
  const stopScroll = deps.attachScroll !== false ? attachScroll(document, pager) : () => {};

  if (deps.watchDom !== false) {
    watcher = watchResults(document, () => {
      // 失效时只跳过本轮；由 content 侧 interval guard 负责 teardown，避免误判瞬时拆掉 UI
      if (!isExtensionContextValid()) return;
      if (disposed) return;
      watcher.runMuted(() => {
        session.refresh();
        realign(document, layout);
        markActive(document, session.engine);
      });
      // check/ingest 在 mute 外发起请求，真正改 DOM 时走 pager.mutate → runMuted
      void pager.check();
    });
  }

  const applyPrefs = (next) => {
    if (disposed) return;
    const normalized = normalizeBootPrefs(next);
    watcher.runMuted(() => {
      session.apply(normalized);
      pager.setEnabled(normalized.autoPage);
      realign(document, layout);
      markActive(document, session.engine);
    });
  };

  let disposed = false;
  let resizeTimer = 0;
  let unsubscribe = () => {};
  if (store?.subscribe) unsubscribe = store.subscribe(applyPrefs);
  const onResize = () => {
    if (disposed) return;
    if (resizeTimer) (globalThis.clearTimeout ?? clearTimeout)(resizeTimer);
    resizeTimer = (globalThis.setTimeout ?? setTimeout)(() => {
      resizeTimer = 0;
      if (disposed) return;
      realign(document, {});
    }, 120);
  };
  const view = document.defaultView;
  if (view && typeof view.addEventListener === "function") {
    view.addEventListener("resize", onResize, { passive: true });
  }

  /**
   * teardown 必须尽量跑完：扩展 reload 后 chrome.storage.removeListener 可能抛错，
   * 不能因此跳过 MutationObserver.disconnect。
   */
  function disposeBoot() {
    if (disposed) return;
    disposed = true;
    const silent = (fn) => {
      try {
        fn();
      } catch {
        // 上下文失效时 chrome.* 常抛错，忽略并继续拆本地资源
      }
    };
    silent(() => unsubscribe());
    silent(() => {
      watcher.runMuted(() => {
        session.dispose?.();
      });
    });
    silent(() => watcher.dispose());
    silent(() => stopScroll());
    silent(() => pager.dispose?.());
    silent(() => clearCenteredLayout(document));
    silent(() => {
      delete document.documentElement.dataset[RELAYOUT_FLAG];
      delete document.documentElement.dataset[DOM_MUTE_FLAG];
      delete document.documentElement.dataset.bspShellWidth;
      delete document.documentElement.dataset.bspActive;
      delete document.documentElement.dataset.bspEngine;
      delete document.documentElement.dataset.bspColumnMode;
      // 拆掉布局时重新关门控；下一次 start/boot 会再打开
      delete document.documentElement.dataset.bspReady;
    });
    silent(() => {
      if (resizeTimer) (globalThis.clearTimeout ?? clearTimeout)(resizeTimer);
    });
    silent(() => view?.removeEventListener?.("resize", onResize));
  }

  return {
    session,
    pager,
    applyPrefs,
    dispose: disposeBoot,
  };
}

/**
 * @param {HTMLElement} box
 * @param {number | undefined} viewportWidth
 */
export function alignSingleCenter(box, viewportWidth) {
  alignResultsBox(box, viewportWidth);
}

/**
 * @param {HTMLElement} box
 * @param {number | undefined} viewportWidth
 */
export function alignResultsBox(box, viewportWidth) {
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
export function contentWidth(mode, viewportWidth) {
  const target = mode === "double" ? DOUBLE_SHELL_MAX : SINGLE_SHELL_MAX;
  const usable = Math.max(0, viewportWidth - SIDE_GAP * 2);
  return Math.min(target, usable);
}

/**
 * @param {Document} document
 * @param {string} mode
 * @param {number} viewportWidth
 */
export function layoutMetrics(document, mode, viewportWidth) {
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
 * @returns {HTMLElement | null}
 */
function findLayoutShell(document) {
  const mcw = document.getElementById("b_mcw");
  if (mcw) return mcw;
  const rcnt = document.getElementById("rcnt");
  if (rcnt) return rcnt;
  // 新版必应：#b_content 下直接是 main + aside，没有 #b_mcw
  const content = document.getElementById("b_content");
  if (content?.querySelector(":scope > main")) return content;
  return null;
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
 * 只清左右外边距。上边距留给页面自己，清掉会把结果列顶进导航。
 * @param {HTMLElement} el
 */
function clearHorizontalMargin(el) {
  el.style.setProperty("margin-left", "0", "important");
  el.style.setProperty("margin-right", "0", "important");
}

/**
 * 百科结果里的横排知识卡（基本用法 | 配图 | 短语）在单列里会贴住标题。
 * 横排容器改成普通块，子块各占通栏，并清掉向上的 top / margin-top。
 * @param {HTMLElement} box
 */
function stackBingFactRows(box) {
  const mode = box.dataset.mode;
  if (mode !== "single-center" && mode !== "double") return;
  for (const card of box.querySelectorAll(":scope > li.b_algo")) {
    const nodes = card.querySelectorAll("div, section, ul, ol");
    for (const el of nodes) {
      if (!isElement(el) || !isSideBySideRow(el)) continue;
      if (el.closest(".b_attribution, .b_tpcn, .b_acf_card, .b_rcGbModImageCard")) continue;
      pinFactBlock(el);
      for (const child of el.children) {
        if (!isElement(child)) continue;
        pinFactBlock(child);
        child.style.setProperty("flex", "none", "important");
      }
    }
  }
}

/**
 * @param {HTMLElement} el
 */
function pinFactBlock(el) {
  stampCentered(el);
  el.style.setProperty("display", "block", "important");
  el.style.setProperty("position", "static", "important");
  el.style.setProperty("top", "auto", "important");
  el.style.setProperty("float", "none", "important");
  el.style.setProperty("clear", "both", "important");
  el.style.setProperty("width", "100%", "important");
  el.style.setProperty("max-width", "100%", "important");
  el.style.setProperty("min-width", "0", "important");
  el.style.setProperty("margin-left", "0", "important");
  el.style.setProperty("margin-right", "0", "important");
  el.style.setProperty("height", "auto", "important");
  el.style.setProperty("max-height", "none", "important");
  el.style.setProperty("overflow", "visible", "important");
  const inlineTop = Number.parseFloat(el.style.marginTop);
  const view = el.ownerDocument?.defaultView;
  const computedTop = typeof view?.getComputedStyle === "function"
    ? Number.parseFloat(view.getComputedStyle(el).marginTop)
    : Number.NaN;
  const marginTop = Number.isFinite(inlineTop) ? inlineTop : computedTop;
  if (Number.isFinite(marginTop) && marginTop < 8) {
    el.style.setProperty("margin-top", "12px", "important");
  }
}

/**
 * @param {HTMLElement} el
 */
function isSideBySideRow(el) {
  const kids = [...el.children].filter((child) => isElement(child) && child.tagName !== "SCRIPT" && child.tagName !== "STYLE");
  if (kids.length < 2) return false;
  const display = (el.style.display || "").toLowerCase().replace(/\s+/g, "");
  if (display.includes("flex") || display.includes("grid")) return true;
  const view = el.ownerDocument?.defaultView;
  if (typeof view?.getComputedStyle === "function") {
    const computed = view.getComputedStyle(el);
    const kind = computed.display;
    if (kind === "flex" || kind === "inline-flex") {
      const dir = computed.flexDirection || "row";
      return dir === "row" || dir === "row-reverse";
    }
    if (kind === "grid" || kind === "inline-grid") {
      return computed.gridTemplateColumns.split(" ").filter(Boolean).length >= 2;
    }
  }
  const sized = kids.filter((child) => /%$|px$/.test(child.style.width || ""));
  return sized.length >= 2;
}

/**
 * 按视口正中落位：定宽后用 margin-left = targetLeft，左右边距对称。
 * 不用 margin:auto（会被窄父级/谷歌残留布局带偏）。
 * @param {HTMLElement} el
 * @param {number} widthPx
 * @param {number} targetLeft
 */
function placeAtViewportCenter(el, widthPx, targetLeft) {
  stampCentered(el);
  const maxW = `min(${widthPx}px, calc(100% - ${SIDE_GAP * 2}px))`;
  // 必应顶栏里的「自定义」提示是相对祖先绝对定位的。改 position / overflow 会换掉包含块，提示会叠到按钮上。
  const keepInnerPosition = el.id === "b_header";
  if (!keepInnerPosition) {
    el.style.setProperty("position", "relative", "important");
    el.style.setProperty("top", "0", "important");
    el.style.setProperty("bottom", "auto", "important");
    el.style.setProperty("left", "auto", "important");
    el.style.setProperty("right", "auto", "important");
    el.style.setProperty("padding-left", "0", "important");
    el.style.setProperty("padding-right", "0", "important");
    el.style.setProperty("transform", "none", "important");
    el.style.setProperty("overflow", "visible", "important");
  }
  el.style.setProperty("width", `${widthPx}px`, "important");
  el.style.setProperty("max-width", maxW, "important");
  el.style.setProperty("min-width", "0", "important");
  el.style.setProperty("margin-left", `${Math.max(0, targetLeft)}px`, "important");
  el.style.setProperty("margin-right", "auto", "important");
  el.style.setProperty("box-sizing", "border-box", "important");
  el.style.setProperty("float", "none", "important");
  el.style.setProperty("align-self", "center", "important");
  // 谷歌把导航放在网格第 2 列起（logo 列之后）：不跨满整行，margin 会叠在 logo 列宽上
  if (isGridItem(el)) {
    el.style.setProperty("grid-column", "1 / -1", "important");
    el.style.setProperty("justify-self", "start", "important");
  }
  correctLeftResidual(el, targetLeft);
  el.dataset.bspPlaced = placedSignature(el, widthPx, targetLeft);
}

/**
 * 落位签名：含补偿后的 margin-left，谷歌改回原生样式时签名对不上就会重排。
 * @param {HTMLElement} el
 * @param {number} widthPx
 * @param {number} targetLeft
 */
function placedSignature(el, widthPx, targetLeft) {
  return `${widthPx}:${targetLeft}:${el.style.width}:${el.style.marginLeft}:${el.style.left}`;
}

/**
 * @param {HTMLElement} el
 */
function isGridItem(el) {
  const parent = el.parentElement;
  const view = el.ownerDocument?.defaultView;
  if (!parent || typeof view?.getComputedStyle !== "function") return false;
  const display = view.getComputedStyle(parent).display;
  return display === "grid" || display === "inline-grid";
}

/**
 * 包含块左缘不在视口 0 处（网格列、带偏移的祖先）时，按实测补回 margin-left 残差。
 * 无布局引擎（linkedom）几何为 0 时跳过。
 * @param {HTMLElement} el
 * @param {number} targetLeft
 */
function correctLeftResidual(el, targetLeft) {
  const rect = rectOf(el);
  if (!(rect.width > 0)) return;
  const residual = Math.round(targetLeft - rect.left);
  if (Math.abs(residual) < 1) return;
  const current = Number.parseFloat(el.style.marginLeft) || 0;
  el.style.setProperty("margin-left", `${current + residual}px`, "important");
}

/**
 * @param {Document} document
 */
function collectHeaderBands(document) {
  /** @type {HTMLElement[]} */
  const bands = [];
  const seen = new Set();
  const push = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    bands.push(el);
  };
  // Google 搜索顶栏保留原生包含块、Logo 槽和账号操作区。
  // 将整个 #searchform/#sfcnt/#sf 缩成结果壳宽会把绝对定位的右侧按钮推入搜索框。
  // 导航仍单独对齐结果列；Bing 顶栏沿用其专用布局。
  for (const id of ["appbar", "slim_appbar", "b_header", "b_tween"]) {
    push(document.getElementById(id));
  }
  return bands;
}

/**
 * 强制把导航条对齐到与搜索栏相同的壳宽/左缘（仅 single-center / double）。
 * 现代谷歌真实标签常在哈希容器里，且带多层左缩进；必须跟搜索栏实测锚点，并清路径缩进。
 * @param {Document} document
 * @param {number} widthPx
 * @param {number} targetLeft
 * @param {Set<HTMLElement>} placed
 */
function placeNavBands(document, widthPx, targetLeft, placed) {
  /** @type {HTMLElement[]} */
  const aligned = [];
  const anchor = resolveSearchShellAnchor(document, widthPx, targetLeft, placed);

  /** @type {HTMLElement[]} */
  const candidates = [];
  const push = (el) => {
    if (!el || !isElement(el) || candidates.includes(el)) return;
    if (!isNavBandVisible(el)) return;
    candidates.push(el);
  };
  for (const id of ["s_tab", "hdtb", "hdtbSum", "hdtb-msb", "hdtbMenus"]) {
    push(document.getElementById(id));
  }
  push(document.querySelector("#s_tab, .s_tab"));
  push(document.querySelector("#hdtb, #hdtbSum"));
  push(document.querySelector("#hdtb-msb"));
  push(document.querySelector("nav.b_scopebar"));

  const roots = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
  for (const el of roots) {
    placeAtViewportCenter(el, anchor.width, anchor.left);
    prepareNavBand(el);
    placed.add(el);
    aligned.push(el);
  }

  const band = findNavTabBand(document);
  if (!band) return aligned;

  // 取「最近」的已落位祖先（不能用 find 第一个：外层 searchform 在部分 DOM 里也会 contains）
  let host = null;
  for (const el of placed) {
    if (el === band || !el.contains(band)) continue;
    if (!host || host.contains(el)) host = el;
  }
  if (host) {
    // 已在搜索壳/顶栏内部：拉满宿主宽度，与搜索栏左右缘一致，再居中标签
    expandNavBandToHost(band, host);
    prepareNavBand(band);
    return aligned;
  }
  if (roots.some((el) => el === band || el.contains(band))) {
    prepareNavBand(band);
    return aligned;
  }
  if ([...placed].some((el) => el !== band && band.contains(el))) {
    prepareNavBand(band);
    return aligned;
  }

  placeAtViewportCenter(band, anchor.width, anchor.left);
  prepareNavBand(band);
  placed.add(band);
  aligned.push(band);
  return aligned;
}

/**
 * 壳已稳态时重放顶栏（搜索壳）+ 导航。
 * 只定外壳宽/左缘，不改写壳内 form/input，避免触发谷歌搜索框清空查询词。
 * @param {Document} document
 * @param {ReturnType<typeof layoutMetrics>} metrics
 */
function refreshChromeLayout(document, metrics) {
  /** @type {Set<HTMLElement>} */
  const placed = new Set();
  for (const id of ["center_col", ...LAYOUT_SHELL_IDS]) {
    const el = document.getElementById(id);
    if (el?.dataset?.bspCentered === "1") placed.add(el);
  }
  for (const el of collectHeaderBands(document)) {
    if (!el) continue;
    // 结果计数在已居中的壳里时，刷新不能再定宽，否则会压住第一条并在刷新后偏到一边
    if (el.id === "b_tween") {
      placeBingResultCount(el, metrics, placed);
      placed.add(el);
      continue;
    }
    // 已按当前壳宽落位则跳过，减少对搜索框 DOM 的样式抖动
    if (
      el.dataset.bspCentered === "1"
      && el.dataset.bspPlaced === placedSignature(el, metrics.shellWidth, metrics.targetLeft)
    ) {
      placed.add(el);
      continue;
    }
    placeAtViewportCenter(el, metrics.shellWidth, metrics.targetLeft);
    placed.add(el);
  }
  placeNavBands(document, metrics.shellWidth, metrics.targetLeft, placed);
  sanitizeNavChrome(document);
  alignGoogleSearchField(document, metrics);
}

const searchFieldStyles = new WeakMap();
const SEARCH_FIELD_PROPS = ["width", "max-width", "min-width", "margin-left", "margin-right", "box-sizing", "flex-shrink"];

function restoreGoogleSearchField(document) {
  const saved = searchFieldStyles.get(document);
  if (!saved) return;
  for (const [prop, value, priority] of saved.styles) {
    if (value) saved.field.style.setProperty(prop, value, priority);
    else saved.field.style.removeProperty(prop);
  }
  if (!saved.hadStyle && !saved.field.style.cssText) saved.field.removeAttribute("style");
  searchFieldStyles.delete(document);
}

// Move only the visible search field, never the full header/account containing block.
// Measure the result column and reserve symmetric space for native controls.
function alignGoogleSearchField(document, metrics) {
  if (document.getElementById("b_results")) return;
  const form = document.querySelector("form#tsf, form[role='search']");
  const input = form?.querySelector("[name='q']");
  if (!input) return;
  const field = input.closest(".A8SBwf") ?? form;
  const initial = rectOf(field);
  if (!(initial.width > 0 && initial.height > 0)) return;
  const previous = searchFieldStyles.get(document);
  if (previous?.field !== field) {
    restoreGoogleSearchField(document);
    searchFieldStyles.set(document, { field, hadStyle:field.hasAttribute("style"),
      styles:SEARCH_FIELD_PROPS.map(prop => [prop, field.style.getPropertyValue(prop), field.style.getPropertyPriority(prop)]) });
  }
  const box = document.getElementById("bsp-results");
  const results = rectOf(box);
  const center = results.width > 0 ? results.left + results.width / 2 : metrics.targetLeft + metrics.mainWidth / 2;
  let left = 16;
  let right = metrics.viewportWidth - 16;
  for (const control of document.querySelectorAll("#gb, #logo, #hplogo, #google-logo")) {
    if (field.contains(control) || !isDisplayed(control)) continue;
    const r = rectOf(control);
    if (r.width <= 0 || r.height <= 0 || r.bottom <= initial.top || r.top >= initial.bottom) continue;
    if (r.left >= center) right = Math.min(right, r.left - 24);
    else if (r.right <= center) left = Math.max(left, r.right + 24);
  }
  const width = Math.min(results.width || metrics.mainWidth, 2 * Math.min(center - left, right - center));
  // Keep the native field when there is no usable slot at the result center.
  if (width < 180) { restoreGoogleSearchField(document); return; }
  field.style.setProperty("width", `${width}px`, "important");
  field.style.setProperty("max-width", "none", "important");
  field.style.setProperty("min-width", "0", "important");
  field.style.setProperty("box-sizing", "border-box", "important");
  field.style.setProperty("flex-shrink", "0", "important");
  field.style.setProperty("margin-left", "0", "important");
  field.style.setProperty("margin-right", "0", "important");
  // Grid/flex parents may contribute their own offset. Correct actual geometry,
  // rather than adding the viewport offset to a native logo gutter a second time.
  for (let pass = 0; pass < 3; pass++) {
    const r = rectOf(field);
    const delta = center - (r.left + r.width / 2);
    if (Math.abs(delta) < 0.5) break;
    const current = Number.parseFloat(field.style.marginLeft) || 0;
    field.style.setProperty("margin-left", `${current + delta}px`, "important");
    field.style.setProperty("margin-right", `${-(current + delta)}px`, "important");
  }
}

/**
 * 结果条数。已在居中壳内就跟着壳走，只留出和第一条结果的间距。
 * 壳外（旧版 #b_mcw 上面）才单独用 margin-left 对齐，并且不动 position / width。
 * @param {HTMLElement} el
 * @param {ReturnType<typeof layoutMetrics>} metrics
 * @param {Set<HTMLElement>} placed
 */
function placeBingResultCount(el, metrics, placed) {
  const insideCentered = [...placed].some((other) => other !== el && other.contains(el));
  stampCentered(el);
  for (const prop of [
    "position", "top", "bottom", "left", "right", "inset", "width", "max-width", "min-width",
    "transform", "padding-left", "padding-right", "float", "align-self", "overflow",
  ]) {
    el.style.removeProperty(prop);
  }
  if (insideCentered) {
    el.style.setProperty("position", "static", "important");
    el.style.setProperty("width", "auto", "important");
    el.style.setProperty("max-width", "100%", "important");
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("margin-right", "0", "important");
    el.style.setProperty("margin-top", "0", "important");
    el.style.setProperty("margin-bottom", "16px", "important");
    return;
  }
  el.style.setProperty("margin-left", `${metrics.targetLeft}px`, "important");
  el.style.setProperty("margin-right", "0", "important");
  el.style.setProperty("float", "none", "important");
}

/** @deprecated 兼容旧调用名 */
function refreshNavLayout(document, metrics) {
  refreshChromeLayout(document, metrics);
}

/**
 * 导航收尾：标签组钉在红框（壳）正中，消灭横向滚动条。
 * 谷歌左侧 logo 槽常是「非空」兄弟节点（有 svg/占位），只藏 empty spacer 不够。
 * @param {Document} document
 */
function sanitizeNavChrome(document) {
  const row = findDocumentNavRow(document);
  if (!row) {
    for (const id of ["s_tab", "s_tab_inner", "hdtb", "hdtb-msb", "appbar"]) {
      const el = document.getElementById(id);
      if (el) killNavOverflow(el);
    }
    return;
  }

  const shell = findNavShellHost(row);

  /** @type {HTMLElement[]} */
  const chain = [];
  for (let node = row; node && isElement(node); node = node.parentElement) {
    chain.push(node);
    if (node === shell) break;
    if (!shell && (NAV_BAND_STOP_IDS.has(node.id) || node.id === "appbar" || node.id === "s_tab")) break;
  }

  for (const node of chain) {
    killNavOverflow(node);
    node.style.setProperty("padding-left", "0", "important");
    node.style.setProperty("padding-inline-start", "0", "important");
    node.style.setProperty("padding-right", "0", "important");
    node.style.setProperty("transform", "none", "important");
    node.style.setProperty("float", "none", "important");
    // 压缩左侧 gutter（含非空占位）+ 空 spacer
    collapseNavBiasSiblings(node, row);

    const isShell = shell ? node === shell : isPlacedNavShell(node);
    if (isShell) {
      node.style.setProperty("display", "flex", "important");
      node.style.setProperty("flex-direction", "row", "important");
      node.style.setProperty("flex-wrap", "nowrap", "important");
      node.style.setProperty("justify-content", "center", "important");
      node.style.setProperty("align-items", "center", "important");
      node.style.setProperty("text-align", "center", "important");
      continue;
    }

    node.style.setProperty("margin-left", "0", "important");
    node.style.setProperty("margin-inline-start", "0", "important");
    if (node === row) {
      shrinkNavInner(node);
      node.style.setProperty("width", "max-content", "important");
      node.style.setProperty("max-width", "100%", "important");
      node.style.setProperty("flex", "0 0 auto", "important");
      node.style.setProperty("margin-left", "0", "important");
      node.style.setProperty("margin-right", "0", "important");
      node.style.setProperty("position", "relative", "important");
      node.style.setProperty("left", "0", "important");
    } else {
      node.style.setProperty("display", "flex", "important");
      node.style.setProperty("flex-direction", "row", "important");
      node.style.setProperty("flex-wrap", "nowrap", "important");
      node.style.setProperty("justify-content", "center", "important");
      node.style.setProperty("align-items", "center", "important");
      node.style.setProperty("width", "100%", "important");
      node.style.setProperty("max-width", "100%", "important");
      node.style.setProperty("box-sizing", "border-box", "important");
      node.style.setProperty("text-align", "center", "important");
      node.style.setProperty("left", "auto", "important");
    }
  }

  // 标签行内部也可能还有一层左缩进 scroller
  clearNavDescendantBias(row);
  if (shell) killNavOverflowTree(shell);
  else killNavOverflowTree(row);
  pinBingOverflowMenus(document);
}

/**
 * 会把芯片顶偏的兄弟：标签行之前的压掉；之后的空 spacer 压掉，
 * 之后的真按钮（如「工具」）贴到右端、脱离居中流，否则整组居中会偏左、标签也会压到它。
 * @param {HTMLElement} parent
 * @param {HTMLElement} row
 */
function collapseNavBiasSiblings(parent, row) {
  const children = [...parent.children].filter(isElement);
  const rowIndex = children.indexOf(row);
  // row 可能是孙级：找到包含 row 的直接子级
  let anchorIndex = rowIndex;
  if (anchorIndex < 0) {
    anchorIndex = children.findIndex((child) => child.contains(row));
  }
  if (anchorIndex < 0) {
    hideEmptyNavSpacers(parent, row);
    return;
  }

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === row || row.contains(child) || child.contains(row)) continue;
    if (isBingOverflowMenu(child)) continue;
    const beforeRow = i < anchorIndex;
    if (!beforeRow && !isEmptyNavSpacer(child)) {
      // 仅标签行的直接父级：更高层的尾随兄弟可能是「工具」展开面板
      if (rowIndex >= 0) anchorNavTrailing(parent, child);
      continue;
    }
    stampCentered(child);
    child.dataset.bspNavSpacer = "1";
    child.style.setProperty("display", "none", "important");
  }
}

/**
 * @param {HTMLElement} parent
 * @param {HTMLElement} child
 */
function anchorNavTrailing(parent, child) {
  if (isBingOverflowMenu(child)) return;
  stampCentered(parent);
  parent.style.setProperty("position", "relative", "important");
  stampCentered(child);
  child.dataset.bspNavTrailing = "1";
  child.style.setProperty("position", "absolute", "important");
  child.style.setProperty("right", "0", "important");
  child.style.setProperty("top", "0", "important");
  child.style.setProperty("bottom", "0", "important");
  child.style.setProperty("left", "auto", "important");
  child.style.setProperty("margin-left", "0", "important");
  child.style.setProperty("display", "flex", "important");
  child.style.setProperty("align-items", "center", "important");
}

/**
 * 标签行内部的横向 scroller（谷歌常在 LCA 内再包一层）：关滚动并清左偏移。
 * 不批量清 padding：「更多」下拉项靠 padding 抵消 margin-left:-12px，清掉会被弹层裁切。
 * @param {HTMLElement} row
 */
function clearNavDescendantBias(row) {
  for (const child of row.querySelectorAll("*")) {
    if (!isElement(child) || isInNavPopup(child, row)) continue;
    if (!isHorizontalScroller(child)) continue;
    killNavOverflow(child);
    child.style.setProperty("margin-left", "0", "important");
    child.style.setProperty("margin-inline-start", "0", "important");
  }
}

/**
 * 壳内会出横向滚动条的节点关掉滚动；弹层（下拉菜单）的 overflow:hidden 圆角裁切保持原样。
 * @param {HTMLElement} root
 */
function killNavOverflowTree(root) {
  killNavOverflow(root);
  for (const el of root.querySelectorAll("*")) {
    if (!isElement(el) || isInNavPopup(el, root)) continue;
    if (isHorizontalScroller(el)) killNavOverflow(el);
  }
}

/**
 * @param {HTMLElement} el
 */
function isHorizontalScroller(el) {
  const inline = el.getAttribute?.("style") ?? "";
  if (/overflow(-x)?\s*:\s*(auto|scroll)/i.test(inline)) return true;
  const view = el.ownerDocument?.defaultView;
  if (typeof view?.getComputedStyle !== "function") return false;
  const overflowX = view.getComputedStyle(el).overflowX;
  return overflowX === "auto" || overflowX === "scroll";
}

/**
 * 是否位于绝对/固定定位的弹层内（「更多」「工具」下拉）。
 * @param {HTMLElement} el
 * @param {HTMLElement} root
 */
function isInNavPopup(el, root) {
  for (let node = el; node && node !== root; node = node.parentElement) {
    if (isBingOverflowMenu(node)) return true;
  }
  const view = el.ownerDocument?.defaultView;
  if (typeof view?.getComputedStyle !== "function") return false;
  for (let node = el; node && node !== root; node = node.parentElement) {
    const position = view.getComputedStyle(node).position;
    if (position === "absolute" || position === "fixed") return true;
  }
  return false;
}

/**
 * 必应「更多」下拉。不能拿计算后的 position 判断：未展开时往往还不是 absolute。
 * @param {HTMLElement | null | undefined} el
 */
function isBingOverflowMenu(el) {
  if (!isElement(el)) return false;
  if (el.classList?.contains("b_sp_over_cont") || el.classList?.contains("b_sp_over_menu")) return true;
  return typeof el.closest === "function" && Boolean(el.closest(".b_sp_over_cont, .b_sp_over_menu"));
}

/**
 * 节点本身或它直接包住必应「更多」弹层。
 * @param {HTMLElement} node
 */
function hostsBingOverflow(node) {
  if (!isElement(node)) return false;
  if (isBingOverflowMenu(node)) return true;
  const menu = node.querySelector?.(".b_sp_over_cont, .b_sp_over_menu");
  if (!menu || !isElement(menu)) return false;
  return menu.parentElement === node || menu.closest("li") === node;
}

/**
 * 把「更多」弹层钉在自己的标签上，并清掉误当成导航尾按钮写上的拉伸样式。
 * @param {Document} document
 */
function pinBingOverflowMenus(document) {
  for (const menu of document.querySelectorAll("nav.b_scopebar .b_sp_over_cont")) {
    if (!isElement(menu)) continue;
    const host = typeof menu.closest === "function" ? menu.closest("li") : menu.parentElement;
    if (host && isElement(host)) {
      host.style.setProperty("position", "relative", "important");
    }
    menu.style.removeProperty("display");
    menu.style.removeProperty("top");
    menu.style.removeProperty("bottom");
    menu.style.removeProperty("height");
    menu.style.removeProperty("width");
    delete menu.dataset.bspNavTrailing;
    delete menu.dataset.bspNavInner;
    delete menu.dataset.bspNavScrollkill;
  }
}

/**
 * 已按壳宽落位的顶栏宿主（#appbar / #s_tab 等）。
 * @param {HTMLElement} from
 * @returns {HTMLElement | null}
 */
function findNavShellHost(from) {
  for (let node = from; node && isElement(node); node = node.parentElement) {
    // 必应：停在 nav.b_scopebar，绝不能把 #b_header（含 logo/表单）改成单行 flex
    if (node.classList?.contains("b_scopebar")) return node;
    if (isPlacedNavShell(node)) return node;
    if (node.id === "appbar" || node.id === "slim_appbar" || node.id === "s_tab") return node;
  }
  return null;
}

/**
 * @param {HTMLElement} el
 */
function isPlacedNavShell(el) {
  if (el.dataset.bspCentered !== "1") return false;
  const w = el.style.width;
  return Boolean(w) && w !== "100%" && w !== "auto" && w !== "max-content";
}

/**
 * 藏起会把标签顶偏的空占位（含 flex-grow 空白条）。
 * @param {HTMLElement} parent
 * @param {HTMLElement} keep
 */
function hideEmptyNavSpacers(parent, keep) {
  for (const child of parent.children) {
    if (!isElement(child) || child === keep || keep.contains(child)) continue;
    if (!isEmptyNavSpacer(child)) continue;
    stampCentered(child);
    child.dataset.bspNavSpacer = "1";
    child.style.setProperty("display", "none", "important");
  }
}

/**
 * 强制关掉导航链上的横向滚动（谷歌芯片行常带 overflow-x:auto）。
 * @param {HTMLElement} el
 */
function killNavOverflow(el) {
  stampCentered(el);
  el.dataset.bspNavScrollkill = "1";
  el.style.setProperty("overflow", "visible", "important");
  el.style.setProperty("overflow-x", "visible", "important");
  el.style.setProperty("overflow-y", "visible", "important");
  el.style.setProperty("scrollbar-width", "none", "important");
  if (typeof el.scrollLeft === "number" && el.scrollLeft !== 0) el.scrollLeft = 0;
}

/** @deprecated 旧名保留 */
function syncNavRowToSearchCenter(document) {
  sanitizeNavChrome(document);
}

/**
 * 整页范围内找主导航标签行（芯片行），排除「工具」等第二行，避免 LCA 过大无法缩宽居中。
 * @param {Document} document
 * @returns {HTMLElement | null}
 */
function findDocumentNavRow(document) {
  const links = collectPrimaryNavTabLinks(document);
  if (links.length < 2) return null;
  let row = links[0];
  for (const link of links) {
    while (row && !row.contains(link)) row = row.parentElement;
    if (!row) return null;
  }
  return isElement(row) ? row : null;
}

/** 第二行工具类文案：不能并入主芯片行 LCA */
const NAV_SECONDARY_LABELS = new Set(["工具", "Tools", "工具箱"]);

/**
 * 主芯片行链接：优先 jsname；有几何时只取同一水平带；排除工具行。
 * @param {Document} document
 * @returns {HTMLElement[]}
 */
function collectPrimaryNavTabLinks(document) {
  const all = collectNavTabLinks(document).filter((el) => {
    const label = (el.textContent ?? "").trim();
    return !NAV_SECONDARY_LABELS.has(label);
  });
  if (all.length < 2) return all;

  // 有真实几何时：取数量最多的同一 top 带（主芯片行）
  /** @type {Map<number, HTMLElement[]>} */
  const bands = new Map();
  for (const el of all) {
    const top = Math.round(rectOf(el).top);
    if (!bands.has(top)) bands.set(top, []);
    bands.get(top)?.push(el);
  }
  let best = all;
  for (const group of bands.values()) {
    if (group.length > best.length) best = group;
  }
  return best.length >= 2 ? best : all;
}

/**
 * 优先用已落位搜索栏的实测宽/左缘，保证导航与搜索栏同一条中线。
 * @param {Document} document
 * @param {number} widthPx
 * @param {number} targetLeft
 * @param {Set<HTMLElement>} placed
 */
function resolveSearchShellAnchor(document, widthPx, targetLeft, placed) {
  for (const id of ["searchform", "sfcnt", "sf", "head"]) {
    const el = document.getElementById(id);
    if (!el || !placed.has(el)) continue;
    const rect = rectOf(el);
    if (rect.width >= 120) {
      return { width: Math.round(rect.width), left: Math.round(rect.left) };
    }
    // 测试 DOM 无几何：用已写入的 style
    const styleW = Number.parseFloat(el.style.width);
    const styleL = Number.parseFloat(el.style.marginLeft);
    if (Number.isFinite(styleW) && styleW >= 120) {
      return {
        width: Math.round(styleW),
        left: Number.isFinite(styleL) ? Math.round(styleL) : targetLeft,
      };
    }
  }
  return { width: widthPx, left: targetLeft };
}

/**
 * @param {HTMLElement} band
 * @param {HTMLElement} host
 */
function expandNavBandToHost(band, host) {
  stampCentered(band);
  band.style.setProperty("position", "relative", "important");
  band.style.setProperty("width", "100%", "important");
  band.style.setProperty("max-width", "100%", "important");
  band.style.setProperty("min-width", "0", "important");
  band.style.setProperty("margin-left", "0px", "important");
  band.style.setProperty("margin-right", "0px", "important");
  band.style.setProperty("padding-left", "0px", "important");
  band.style.setProperty("padding-inline-start", "0px", "important");
  band.style.setProperty("left", "auto", "important");
  band.style.setProperty("right", "auto", "important");
  band.style.setProperty("float", "none", "important");
  band.style.setProperty("transform", "none", "important");
  band.style.setProperty("box-sizing", "border-box", "important");
  // 宿主到 band 整条链清左缩进，避免夹在中间的哈希层把标签顶右。
  // 已定壳宽的顶栏本身（host）绝不能改成 100%/margin0。
  let node = band.parentElement;
  while (node && isElement(node) && host.contains(node) && node !== host) {
    node.style.setProperty("padding-left", "0", "important");
    node.style.setProperty("padding-inline-start", "0", "important");
    node.style.setProperty("margin-left", "0", "important");
    node.style.setProperty("margin-inline-start", "0", "important");
    node.style.setProperty("width", "100%", "important");
    node.style.setProperty("max-width", "100%", "important");
    node = node.parentElement;
  }
}

/**
 * @param {HTMLElement} el
 */
function prepareNavBand(el) {
  clearNavInlineBias(el);
  clearNavPathBias(el);
  centerNavContent(el);
}

/**
 * 从标签链接向上清到导航壳：谷歌常把 padding-left 写在中间哈希层。
 * 壳自身的 margin-left 由 placeAtViewportCenter 写入，不能清掉。
 * @param {HTMLElement} band
 */
function clearNavPathBias(band) {
  const links = collectNavTabLinks(band.ownerDocument).filter((link) => band.contains(link));
  const starts = links.length > 0 ? links : [band];
  for (const start of starts) {
    // 从链接父级往上清：标签自身 padding/margin（必应 li 间距、链接内边距）保留
    let node = start === band ? band : start.parentElement;
    while (node && isElement(node)) {
      // 「更多」宿主的 padding 用来抵消弹层 margin-left:-12px，清掉会被裁成一条竖线
      if (!hostsBingOverflow(node)) {
        node.style.setProperty("padding-left", "0", "important");
        node.style.setProperty("padding-inline-start", "0", "important");
      }
      // 必应 li 间距是标签本身样式，不能当偏移清掉
      if (node !== band && node.tagName !== "LI" && !hostsBingOverflow(node)) {
        node.style.setProperty("margin-left", "0", "important");
        node.style.setProperty("margin-inline-start", "0", "important");
      }
      if (node === band) break;
      node = node.parentElement;
    }
  }
}

/**
 * 导航带是否真的有可见内容（现代谷歌 #hdtb 是 0 高空壳，写样式没有意义）。
 * 无布局引擎（如 linkedom）时几何为 0：仍允许已知导航根落位。
 * @param {HTMLElement} el
 */
function isNavBandVisible(el) {
  const rect = rectOf(el);
  if (rect.height >= 8 && rect.width >= 120) return true;
  if (
    el.id === "s_tab"
    || el.classList?.contains("s_tab")
    || el.classList?.contains("b_scopebar")
  ) {
    return typeof el.getBoundingClientRect !== "function"
      || (rect.width === 0 && rect.height === 0);
  }
  return false;
}

/**
 * 导航标签在壳内水平居中（与搜索栏同壳后，标签组落在壳正中）。
 * @param {HTMLElement} el
 */
function centerNavContent(el) {
  stampCentered(el);
  clearNavInlineBias(el);
  applyNavFlexCenter(el);

  for (const child of el.children) {
    if (!isElement(child)) continue;
    const isKnownInner = child.id === "s_tab_inner"
      || child.classList.contains("s_tab_inner")
      || child.id === "hdtb-msb";
    if (isKnownInner) shrinkNavInner(child);
  }

  const row = findNavTabRowIn(el);
  if (!row || row === el) return;

  shrinkNavInner(row);
  row.style.setProperty("overflow", "visible", "important");
  row.style.setProperty("transform", "none", "important");
  // 仅压缩「无文本、无链接」的空占位
  const parent = row.parentElement;
  if (!parent || !isElement(parent)) return;
  applyNavFlexCenter(parent);
  parent.style.setProperty("overflow", "visible", "important");
  parent.style.setProperty("overflow-x", "visible", "important");
  // 父级若就是导航壳（已 placeAtViewportCenter 定宽），不能改成 100% 盖掉壳宽
  if (parent !== el) {
    parent.style.setProperty("width", "100%", "important");
    parent.style.setProperty("max-width", "100%", "important");
  }
  parent.style.setProperty("padding-left", "0", "important");
  parent.style.setProperty("justify-content", "center", "important");
  if (typeof parent.scrollLeft === "number") parent.scrollLeft = 0;
  for (const sibling of parent.children) {
    if (!isElement(sibling) || sibling === row) continue;
    if (!isEmptyNavSpacer(sibling)) continue;
    stampCentered(sibling);
    sibling.dataset.bspNavSpacer = "1";
    sibling.style.setProperty("display", "none", "important");
  }
}

/**
 * 标签链接的最紧公共祖先。
 * @param {HTMLElement} scope
 * @returns {HTMLElement | null}
 */
function findNavTabRowIn(scope) {
  const links = collectPrimaryNavTabLinks(scope.ownerDocument).filter((link) => scope.contains(link));
  if (links.length < 2) return null;
  let row = links[0];
  for (const link of links) {
    while (row && !row.contains(link)) row = row.parentElement;
    if (!row) return null;
  }
  return row && scope.contains(row) ? row : null;
}

/**
 * 真正的空占位：无可见文案、无 a/button。含「全部/新闻…」的节点绝不能匹配。
 * @param {HTMLElement} el
 */
function isEmptyNavSpacer(el) {
  if (el.getAttribute?.("aria-hidden") === "true") return true;
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text.length > 0) return false;
  if (el.querySelector("a, button, [role='button'], [role='link']")) return false;
  return true;
}

/**
 * @param {HTMLElement} el
 */
function applyNavFlexCenter(el) {
  el.style.setProperty("display", "flex", "important");
  el.style.setProperty("flex-direction", "row", "important");
  el.style.setProperty("flex-wrap", "nowrap", "important");
  el.style.setProperty("justify-content", "center", "important");
  el.style.setProperty("align-items", "center", "important");
  el.style.setProperty("text-align", "center", "important");
}

/**
 * 内层标签行缩成内容宽，才能被外层 flex 推到壳正中。
 * @param {HTMLElement} el
 */
function shrinkNavInner(el) {
  stampCentered(el);
  el.dataset.bspNavInner = "1";
  applyNavFlexCenter(el);
  el.style.setProperty("width", "max-content", "important");
  el.style.setProperty("max-width", "100%", "important");
  el.style.setProperty("flex", "0 0 auto", "important");
  el.style.setProperty("margin-left", "auto", "important");
  el.style.setProperty("margin-right", "auto", "important");
  el.style.setProperty("float", "none", "important");
  el.style.setProperty("overflow", "visible", "important");
  el.style.setProperty("left", "auto", "important");
  el.style.setProperty("transform", "none", "important");
}

/**
 * 按标签文本/稳定标记找出承载导航标签的“单行带”。
 * @param {Document} document
 * @returns {HTMLElement | null}
 */
function findNavTabBand(document) {
  const links = collectNavTabLinks(document);
  if (links.length < 2) return null;

  let band = links[0];
  for (const link of links) {
    while (band && !band.contains(link)) band = band.parentElement;
    if (!band) return null;
  }
  if (!band || isOwnDomElement(band)) return null;

  const view = document.defaultView;
  const viewport = document.body?.clientWidth || document.documentElement?.clientWidth || view?.innerWidth || 0;
  const widthLimit = viewport > 0 ? viewport * 0.95 : Infinity;
  let el = band;
  while (el?.parentElement && el.parentElement !== document.body && el.parentElement !== document.documentElement) {
    const parent = el.parentElement;
    if (NAV_BAND_STOP_IDS.has(parent.id)) break;
    if (isOwnDomElement(parent)) break;
    const rect = rectOf(parent);
    if (rect.height > NAV_BAND_MAX_HEIGHT || rect.width >= widthLimit) break;
    el = parent;
  }
  if (NAV_BAND_STOP_IDS.has(el.id)) return null;
  return el;
}

/**
 * @param {Document} document
 * @returns {HTMLElement[]}
 */
function collectNavTabLinks(document) {
  /** @type {HTMLElement[]} */
  const tagged = [];
  for (const el of document.querySelectorAll(`a[jsname="${NAV_TAB_JSNAME}"], ${BING_NAV_TAB_SELECTOR}`)) {
    if (el && isElement(el) && !isOwnDomElement(el) && !isBingOverflowMenu(el)) tagged.push(el);
  }
  const visibleTagged = tagged.filter(isVisibleLink);
  if (visibleTagged.length >= 2) return visibleTagged;
  // 首屏几何常为 0：仍用 jsname / 必应选择器集合，避免导航永远不居中
  if (tagged.length >= 2) return tagged;

  // 兜底：顶栏/导航容器内按文案匹配（现代谷歌不在 #hdtb 里）
  /** @type {HTMLElement[]} */
  const fallback = [];
  for (const el of document.querySelectorAll(
    "#hdtb a, #s_tab a, .s_tab a, #appbar a, #head a, nav.b_scopebar a, [role='navigation'] a",
  )) {
    if (!isElement(el)) continue;
    if (!NAV_TAB_LABELS.has((el.textContent ?? "").trim())) continue;
    if (isOwnDomElement(el) || isBingOverflowMenu(el)) continue;
    fallback.push(el);
  }
  const visibleFallback = fallback.filter(isVisibleLink);
  return visibleFallback.length >= 2 ? visibleFallback : fallback;
}

/**
 * @param {HTMLElement} el
 */
function isVisibleLink(el) {
  const rect = rectOf(el);
  return rect.width >= 16 && rect.height >= 16;
}

/**
 * 安全取几何：没有 getBoundingClientRect（极简/测试 DOM）时返回零矩形而不是抛错。
 * @param {HTMLElement | null | undefined} el
 */
function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  return el.getBoundingClientRect();
}

/**
 * Node 环境（linkedom）可能没有全局 HTMLElement，用 nodeType 判断元素节点。
 * @param {unknown} node
 * @returns {node is HTMLElement}
 */
function isElement(node) {
  return Boolean(node && typeof node === "object" && /** @type {{ nodeType?: number }} */ (node).nodeType === 1);
}

/**
 * 清掉导航带及其一层子级上的原生左缩进（谷歌常把 padding 写在内层）。
 * 根节点的 margin-left 由 placeAtViewportCenter 写入，这里不能清掉。
 * @param {HTMLElement} el
 */
function clearNavInlineBias(el) {
  const clearPadding = (node) => {
    node.style.setProperty("padding-left", "0", "important");
    node.style.setProperty("padding-right", "0", "important");
    node.style.setProperty("padding-inline-start", "0", "important");
  };
  const clearChildBias = (node) => {
    clearPadding(node);
    node.style.setProperty("margin-left", "0", "important");
    node.style.setProperty("margin-inline-start", "0", "important");
  };
  clearPadding(el);
  for (const child of el.children) {
    if (isElement(child)) clearChildBias(child);
  }
}

/**
 * 头部/导航定宽：保留给旧调用方；真正居中统一走 placeAtViewportCenter。
 * @param {HTMLElement} el
 * @param {number} widthPx
 * @param {number} [targetLeft]
 */
function alignBandToTarget(el, widthPx, targetLeft = 0) {
  placeAtViewportCenter(el, widthPx, targetLeft);
}

/**
 * @param {HTMLElement} el
 * @param {number} targetLeft
 */
function shiftNavBand(el, targetLeft) {
  clearNavInlineBias(el);
  settleLeft(el, targetLeft);
}

/**
 * 闭环校正左缘：先归零量一次，写出 relative 位移，再复测并补掉残差。
 * 父级 grid/flex 夹持、auto margin、祖先 zoom/transform 都可能让“一次算差值”落不到位。
 * @param {HTMLElement} el
 * @param {number} targetLeft
 */
function settleLeft(el, targetLeft) {
  el.style.setProperty("left", "0", "important");
  const base = rectOf(el).left;
  let offset = clampNavOffset(base, Math.round(targetLeft - base));
  el.style.setProperty("left", `${offset}px`, "important");
  for (let round = 0; round < 2; round += 1) {
    const residual = Math.round(targetLeft - rectOf(el).left);
    if (residual === 0) break;
    offset = clampNavOffset(base, offset + residual);
    el.style.setProperty("left", `${offset}px`, "important");
  }
}

/**
 * 别把左缘推出视口。
 * @param {number} base
 * @param {number} offset
 */
function clampNavOffset(base, offset) {
  if (base + offset < SIDE_GAP) return Math.round(SIDE_GAP - base);
  return offset;
}

/**
 * 收尾复测：全部定位写完后，用结果列“最终”左缘再对一次。
 * 结果列可能因头部定宽而二次回流，这里最多补两轮，避免与结果列互相追。
 * @param {HTMLElement} box
 * @param {HTMLElement[]} bands
 */
function reconcileBands(box, bands) {
  if (!bands.length) return;
  for (let round = 0; round < 2; round += 1) {
    const left = Math.round(rectOf(box).left);
    if (!Number.isFinite(left) || left <= 0) return;
    let settled = true;
    for (const el of bands) {
      settleLeft(el, left);
      if (Math.abs(Math.round(rectOf(el).left) - left) > 1) settled = false;
    }
    if (settled) return;
  }
}

/**
 * 结果列可能过几帧才落位（首次实测可能不可用）。这里持续收敛：量到合理左缘就对齐，
 * 直到全部对齐或次数用尽。只写 relative 偏移，且结果列一旦变化就跟着走，
 * 已 dispose 的元素由 data-bsp-centered 标记守卫跳过。
 * @param {Document} document
 * @param {HTMLElement} box
 * @param {HTMLElement[]} bands
 * @param {number} [attempts]
 * @param {number} [intervalMs]
 */
function scheduleSettleRetry(document, box, bands, attempts = 10, intervalMs = 140) {
  const view = document.defaultView;
  if (!view || typeof view.setTimeout !== "function" || !bands.length) return;
  let round = 0;
  const tick = () => {
    round += 1;
    const measured = box.isConnected ? measureBoxRect(box) : null;
    let settled = true;
    if (measured) {
      for (const el of bands) {
        if (!el.isConnected || el.dataset?.bspCentered !== "1") continue;
        if (Math.abs(Math.round(rectOf(el).left) - measured.left) <= 1) continue;
        settleLeft(el, measured.left);
        settled = false;
      }
    } else {
      settled = false;
    }
    if (settled || round >= attempts) return;
    view.setTimeout(tick, intervalMs);
  };
  view.setTimeout(tick, intervalMs);
}

/**
 * 同一条祖先链上只定宽一次，防止双重位移。
 * @param {HTMLElement | null} el
 * @param {number} widthPx
 * @param {number} targetLeft
 * @param {Set<HTMLElement>} placed
 * @returns {boolean} 是否真的写了定位
 */
function placeBandOnce(el, widthPx, targetLeft, placed) {
  if (!el || !widthPx || widthPx <= 0) return false;
  for (const other of placed) {
    if (other.contains(el) || el.contains(other)) return false;
  }
  alignBandToTarget(el, widthPx, targetLeft);
  placed.add(el);
  return true;
}

/**
 * 同一条祖先链上只定宽一次，防止双重位移。
 * @param {HTMLElement | null} el
 * @param {number} widthPx
 * @param {number} targetLeft
 * @param {Set<HTMLElement>} placed
 */
function placeShellOnce(el, widthPx, targetLeft, placed) {
  if (!el || !widthPx || widthPx <= 0) return;
  for (const other of placed) {
    if (other.contains(el) || el.contains(other)) return;
  }
  placeAt(el, widthPx, targetLeft);
  placed.add(el);
}

/**
 * 按视口目标左缘校正：谷歌 flex 父级下 margin:auto 常无效，需用实测 delta。
 * 不再配合 overflow:clip，避免搜索框被裁切。
 * @param {HTMLElement} el
 * @param {number} widthPx
 * @param {number} targetLeft
 */
function placeAt(el, widthPx, targetLeft) {
  stampCentered(el);
  const view = el.ownerDocument?.defaultView;
  const position = view && typeof view.getComputedStyle === "function"
    ? view.getComputedStyle(el).position
    : "";
  const maxW = `min(${widthPx}px, calc(100vw - ${SIDE_GAP * 2}px))`;
  el.style.setProperty("width", `${widthPx}px`, "important");
  el.style.setProperty("max-width", maxW, "important");
  el.style.setProperty("min-width", "0", "important");
  el.style.setProperty("padding-left", "0", "important");
  el.style.setProperty("padding-right", "0", "important");
  el.style.setProperty("box-sizing", "border-box", "important");
  el.style.setProperty("float", "none", "important");
  el.style.setProperty("transform", "none", "important");
  el.style.setProperty("right", "auto", "important");
  el.style.setProperty("overflow", "visible", "important");
  el.style.setProperty("align-self", "center", "important");

  if (position === "fixed" || position === "sticky") {
    // sticky/fixed 的 left 不负责文档流水平居中；改为 relative 位移
    el.style.setProperty("position", "relative", "important");
    el.style.setProperty("top", position === "sticky" ? "0" : "auto", "important");
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("margin-right", "0", "important");
    settleLeft(el, targetLeft);
    return;
  }

  el.style.setProperty("left", "auto", "important");
  el.style.setProperty("margin-left", "0", "important");
  el.style.setProperty("margin-right", "auto", "important");
  const currentLeft = typeof el.getBoundingClientRect === "function"
    ? el.getBoundingClientRect().left
    : 0;
  let delta = Math.round(targetLeft - currentLeft);
  // 防止校正过量把左缘顶出视口
  if (currentLeft + delta < SIDE_GAP) {
    delta = Math.round(SIDE_GAP - currentLeft);
  }
  el.style.setProperty("margin-left", `${delta}px`, "important");
}

/**
 * @param {HTMLElement} el
 */
function stampCentered(el) {
  el.dataset.bspCentered = "1";
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
 * @param {{ check: () => Promise<unknown> }} pager
 */
export function attachScroll(document, pager) {
  const view = document.defaultView;
  if (!view || typeof view.addEventListener !== "function") return () => {};
  let queued = false;
  let stopped = false;
  const onScroll = () => {
    if (stopped || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (stopped) return;
      void pager.check();
    });
  };
  view.addEventListener("scroll", onScroll, { passive: true });
  void pager.check();
  return () => {
    stopped = true;
    view.removeEventListener("scroll", onScroll);
  };
}

/**
 * 结果区观察根：只盯搜索引擎结果容器，绝不退化为整页 documentElement。
 * @param {Document} document
 * @returns {Element | null}
 */
export function resolveResultsWatchRoot(document) {
  for (const id of RESULTS_WATCH_IDS) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

/**
 * @param {Document} document
 * @param {() => void} onChange
 * @returns {{ dispose: () => void, runMuted: <T>(fn: () => T) => T }}
 */
export function watchResults(document, onChange) {
  const noop = {
    dispose() {},
    runMuted(fn) {
      return fn();
    },
  };
  if (typeof MutationObserver !== "function") return noop;

  let timer = 0;
  let muteDepth = 0;
  /** @type {MutationObserver | null} */
  let observer = null;
  /** @type {ReturnType<typeof setInterval> | number | null} */
  let findTimer = null;
  let findAttempts = 0;

  const clearTimer = () => {
    if (!timer) return;
    (globalThis.clearTimeout ?? clearTimeout)(timer);
    timer = 0;
  };

  const clearFindTimer = () => {
    if (findTimer == null) return;
    (globalThis.clearInterval ?? clearInterval)(findTimer);
    findTimer = null;
  };

  const onMutations = (records) => {
    if (muteDepth > 0) return;
    if (document.documentElement.dataset[RELAYOUT_FLAG]) return;
    if (document.documentElement.dataset[DOM_MUTE_FLAG]) return;
    if (records.every(isOwnDomMutation)) return;
    if (timer) return;
    timer = (globalThis.setTimeout ?? setTimeout)(() => {
      timer = 0;
      onChange();
    }, 120);
  };

  /** @type {MutationObserver[]} */
  const observers = [];
  const observedScopes = new Set();

  const attach = (root) => {
    if ([...observedScopes].some(scope => scope.contains(root))) return;
    const obs = new MutationObserver(onMutations);
    obs.observe(root, { childList: true, subtree: true });
    observers.push(obs);
    observedScopes.add(root);
    observer = obs;
  };

  const attachNavWatches = (except) => {
    for (const id of NAV_WATCH_IDS) {
      const el = document.getElementById(id);
      if (!el || el === except || except?.contains(el)) continue;
      attach(el);
    }
  };

  const root = resolveResultsWatchRoot(document);
  if (root) {
    // 顶部 AI 常是 #center_col 的兄弟；只观察 #rso 会漏掉它的插入。
    const shell = findLayoutShell(document);
    const scope = shell?.contains(root) ? shell : root;
    attach(scope);
    attachNavWatches(scope);
  } else {
    // 结果容器晚到时用有界轮询挂载，避免对 body 开 subtree 观察（易 OOM）
    findTimer = (globalThis.setInterval ?? setInterval)(() => {
      findAttempts += 1;
      const found = resolveResultsWatchRoot(document);
      if (found) {
        clearFindTimer();
        const shell = findLayoutShell(document);
        const scope = shell?.contains(found) ? shell : found;
        attach(scope);
        attachNavWatches(scope);
        onChange();
        return;
      }
      if (findAttempts >= 40) clearFindTimer();
    }, 250);
  }

  return {
    /**
     * 自身 DOM 改写期间屏蔽观察，并用 takeRecords 丢掉已堆积记录，避免清 mute 后二次触发。
     * @template T
     * @param {() => T} fn
     * @returns {T}
     */
    runMuted(fn) {
      muteDepth += 1;
      document.documentElement.dataset[DOM_MUTE_FLAG] = "1";
      try {
        return fn();
      } finally {
        for (const obs of observers) obs.takeRecords?.();
        clearTimer();
        muteDepth -= 1;
        if (muteDepth === 0) delete document.documentElement.dataset[DOM_MUTE_FLAG];
      }
    },
    dispose() {
      clearFindTimer();
      for (const obs of observers) {
        try {
          obs.disconnect();
        } catch {
          // ignore
        }
      }
      observers.length = 0;
      observedScopes.clear();
      observer = null;
      clearTimer();
      muteDepth = 0;
      delete document.documentElement.dataset[DOM_MUTE_FLAG];
    },
  };
}

/**
 * 扩展自身写入（bsp-* 节点、origin 注释、结果盒内外搬移的 bsp 子树）视为自有变更。
 * @param {MutationRecord} record
 */
export function isOwnDomMutation(record) {
  if (isOwnDomNode(record.target)) return true;
  const touched = [];
  if (record.addedNodes?.length) touched.push(...record.addedNodes);
  if (record.removedNodes?.length) touched.push(...record.removedNodes);
  if (touched.length === 0) return false;
  return touched.every(isOwnDomNode);
}

/**
 * @param {Node | null | undefined} node
 */
function isOwnDomNode(node) {
  if (!node) return false;
  if (node.nodeType === 8) {
    return String(node.data ?? node.nodeValue ?? "").includes("bsp-origin");
  }
  if (node.nodeType === 3) {
    return isOwnDomElement(/** @type {Element | null} */ (node.parentElement));
  }
  if (node.nodeType !== 1) return false;
  return isOwnDomElement(/** @type {Element} */ (node));
}

/**
 * @param {Element | null | undefined} el
 */
function isOwnDomElement(el) {
  if (!el) return false;
  if (el.id?.startsWith("bsp-")) return true;
  if (typeof el.closest === "function") {
    if (el.closest("#bsp-results, #bsp-status, .bsp-site-search-wrap")) return true;
  }
  return false;
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

/**
 * @param {Document} document
 * @param {string} engine
 */
function markActive(document, engine) {
  document.documentElement.dataset.bspActive = "1";
  document.documentElement.dataset.bspEngine = engine;
  const box = document.getElementById("bsp-results");
  if (box) {
    box.dataset.bspCount = String(box.children.length);
    if (box.dataset.mode) document.documentElement.dataset.bspColumnMode = box.dataset.mode;
    else delete document.documentElement.dataset.bspColumnMode;
  } else {
    delete document.documentElement.dataset.bspActive;
    delete document.documentElement.dataset.bspColumnMode;
  }
}

/**
 * @param {object} prefs
 */
function normalizeBootPrefs(prefs) {
  return {
    columnMode: prefs.columnMode ?? DEFAULT_PREFS.columnMode,
    autoPage: prefs.autoPage ?? DEFAULT_PREFS.autoPage,
  };
}

const BING_RAIL_KEEP_IDS = new Set(["b_tween", "b_topw", "b_header", "b_results"]);

/**
 * 必应结果列后面的兄弟是右栏知识卡。新版不一定用 aside / #b_context，
 * 留在原生 flex/grid 里会和主列并排，单列居中时右侧被裁切。
 * @param {Document} document
 * @param {HTMLElement | null} shell
 * @param {HTMLElement | null} column
 */
function hideBingSideRails(document, shell, column) {
  if (!document.getElementById("b_results") && !document.getElementById("b_header")) return;
  /** @type {HTMLElement[]} */
  const scopes = [];
  const add = (el) => {
    if (!el || !isElement(el) || scopes.includes(el)) return;
    scopes.push(el);
  };
  add(shell);
  add(document.getElementById("b_content"));
  add(document.getElementById("b_mcw"));
  add(document.getElementById("b_results")?.parentElement);

  for (const scope of scopes) {
    for (const child of scope.children) {
      if (!isElement(child)) continue;
      if (child === column || child.contains(column) || column?.contains(child)) continue;
      if (BING_RAIL_KEEP_IDS.has(child.id)) continue;
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      if (child.id === "bsp-results" || child.dataset?.bspResultsHost === "1") continue;
      if (!shouldHideBingSibling(child, column)) continue;
      stampCentered(child);
      child.style.setProperty("display", "none", "important");
    }
  }
}

/**
 * 结果列之后的兄弟视为右栏；已知知识卡类名不论前后都收起。
 * @param {HTMLElement} child
 * @param {HTMLElement | null} column
 */
function shouldHideBingSibling(child, column) {
  if (child.tagName === "ASIDE" || child.id === "b_context") return true;
  if (child.getAttribute("role") === "complementary") return true;
  if (child.classList?.contains("b_entityTP") || child.classList?.contains("lite-entcard")) return true;
  if (child.querySelector?.("#b_context, .b_entityTP, .lite-entcard")) return true;
  if (!column || !column.parentElement?.contains(child)) return false;
  const childIsBeforeColumn = Boolean(
    child.compareDocumentPosition(column) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  return !childIsBeforeColumn;
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
 * @param {HTMLElement} el
 */
function isDisplayed(el) {
  if (el.style?.display === "none") return false;
  const view = el.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") return true;
  const style = view.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function measureViewport() {
  // 必须用“结果列真正的包含块宽度”，而不是 innerWidth：
  // innerWidth 含滚动条，body 自身还可能再窄一截（实测 1920 → 1905 → 1890），
  // 用 innerWidth 推算 targetLeft 会稳定偏出十几像素，头部/导航就和卡片列错位。
  const bodyWidth = globalThis.document?.body?.clientWidth;
  if (typeof bodyWidth === "number" && bodyWidth > 0) return bodyWidth;
  const layoutWidth = globalThis.document?.documentElement?.clientWidth;
  if (typeof layoutWidth === "number" && layoutWidth > 0) return layoutWidth;
  const width = globalThis.innerWidth;
  return typeof width === "number" && width > 0 ? width : undefined;
}

/**
 * 实测结果列几何。左缘 <= 0 说明此刻还没布局完（或不可见），返回 null 交给延迟重试，
 * 绝不能用推算值顶替，否则会稳定偏出滚动条那几像素。
 * @param {HTMLElement} box
 * @returns {{ left: number, width: number } | null}
 */
function measureBoxRect(box) {
  const rect = rectOf(box);
  const left = Math.round(rect.left);
  if (!Number.isFinite(left) || left <= 0) return null;
  return { left, width: Math.round(rect.width) };
}

/**
 * 父级是普通块容器时，auto margin 能在真实包含块内居中（grid/flex 下会被忽略）。
 * @param {HTMLElement} el
 */
function isBlockParent(el) {
  const parent = el.parentElement;
  const view = el.ownerDocument?.defaultView;
  if (!parent || !view || typeof view.getComputedStyle !== "function") return false;
  const display = view.getComputedStyle(parent).display;
  return display === "block" || display === "flow-root";
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
