import { createSearchSession, isDesktopWebSearch } from "./search-session.mjs";
import { createAutoPager, fetchHtmlDocument } from "./auto-page.mjs";
import { DEFAULT_PREFS, createChromePrefsStore } from "./preferences.mjs";
import { isExtensionContextValid } from "./content-lifecycle.mjs";

export { DEFAULT_PREFS };

const SINGLE_VIEW_RATIO = 0.92;
/** 双列：略窄于视口，保证两侧安全边，两卡等宽 */
const DOUBLE_VIEW_RATIO = 0.88;
const SIDE_GAP = 24;
const SINGLE_MIN = 640;
const DOUBLE_MIN = 880;
const ASIDE_GAP = 24;
const ASIDE_MAX = 368;

const CENTERED_STYLE_PROPS = [
  "width",
  "max-width",
  "min-width",
  "margin-left",
  "margin-right",
  "padding-left",
  "padding-right",
  "float",
  "left",
  "right",
  "transform",
  "display",
  "flex-direction",
  "align-items",
  "gap",
  "flex",
  "flex-shrink",
  "flex-grow",
  "position",
  "box-sizing",
];

const ASIDE_IDS = ["rhs", "content_right"];
const RELAYOUT_FLAG = "bspRelayout";
/** 自身 DOM 改写期间屏蔽 MutationObserver，避免 refresh/搬移结果节点形成反馈环 */
const DOM_MUTE_FLAG = "bspDomMute";

const RESULTS_WATCH_IDS = ["rso", "search", "center_col", "content_left"];

/**
 * @param {Document} document
 * @param {string} url
 * @param {{ viewportWidth?: number, parentLeft?: number }} [layout]
 * @param {{
 *   prefs?: { columnMode?: string, highlight?: boolean, autoPage?: boolean },
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
      if (!isExtensionContextValid()) {
        disposeBoot();
        return;
      }
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

  const root = document.documentElement;
  root.dataset[RELAYOUT_FLAG] = "1";
  try {
    clearCenteredLayout(document);
    const metrics = layoutMetrics(document, mode, viewportWidth);
    applyShellLayout(document, box, metrics);
    root.dataset.bspShellWidth = String(metrics.shellWidth);
    root.style.setProperty("--bsp-shell-width", `${metrics.shellWidth}px`);
    root.style.setProperty("--bsp-main-width", `${metrics.mainWidth}px`);
  } finally {
    delete root.dataset[RELAYOUT_FLAG];
  }
}

/**
 * @param {string} mode
 * @param {number} viewportWidth
 */
export function contentWidth(mode, viewportWidth) {
  const ratio = mode === "double" ? DOUBLE_VIEW_RATIO : SINGLE_VIEW_RATIO;
  const floor = mode === "double" ? DOUBLE_MIN : SINGLE_MIN;
  const usable = Math.max(0, viewportWidth - SIDE_GAP * 2);
  return Math.min(usable, Math.max(Math.min(floor, usable), Math.round(viewportWidth * ratio)));
}

/**
 * @param {Document} document
 * @param {string} mode
 * @param {number} viewportWidth
 */
export function layoutMetrics(document, mode, viewportWidth) {
  const maxShell = Math.max(320, viewportWidth - SIDE_GAP * 2);
  const aside = visibleAside(document);
  const asideInShell = aside && document.getElementById("rcnt")?.contains(aside);
  const asideWidth = asideInShell ? measureAsideWidth(aside, maxShell) : 0;

  if (asideWidth > 0) {
    const mainWidth = Math.min(
      contentWidth(mode, viewportWidth),
      maxShell - ASIDE_GAP - asideWidth,
    );
    const shellWidth = Math.min(maxShell, mainWidth + ASIDE_GAP + asideWidth);
    return {
      mainWidth,
      asideWidth,
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
  const column = document.getElementById("center_col")
    ?? document.getElementById("content_left")
    ?? box.parentElement;
  const rcnt = document.getElementById("rcnt");

  neutralizeGoogleLeftBias(document);

  /** @type {Set<HTMLElement>} */
  const placed = new Set();
  for (const el of collectHeaderBands(document)) {
    placeShellOnce(el, metrics.shellWidth, metrics.targetLeft, placed);
  }

  if (metrics.hasAside && rcnt && metrics.aside && metrics.asideInShell) {
    placeShellOnce(rcnt, metrics.shellWidth, metrics.targetLeft, placed);
    rcnt.style.setProperty("display", "flex", "important");
    rcnt.style.setProperty("flex-direction", "row", "important");
    rcnt.style.setProperty("align-items", "flex-start", "important");
    rcnt.style.setProperty("gap", `${metrics.gap}px`, "important");

    if (column) {
      stampCentered(column);
      column.style.setProperty("flex", "1 1 0", "important");
      column.style.setProperty("min-width", "0", "important");
      column.style.setProperty("max-width", `${metrics.mainWidth}px`, "important");
      column.style.setProperty("width", "auto", "important");
      column.style.setProperty("margin", "0", "important");
      column.style.setProperty("padding", "0", "important");
      column.style.setProperty("float", "none", "important");
    }

    stampCentered(metrics.aside);
    metrics.aside.style.setProperty("flex", `0 0 ${metrics.asideWidth}px`, "important");
    metrics.aside.style.setProperty("width", `${metrics.asideWidth}px`, "important");
    metrics.aside.style.setProperty("max-width", `${metrics.asideWidth}px`, "important");
    metrics.aside.style.setProperty("min-width", "0", "important");
    metrics.aside.style.setProperty("margin", "0", "important");
    metrics.aside.style.setProperty("float", "none", "important");
    metrics.aside.style.setProperty("position", "relative", "important");
  } else if (column) {
    placeShellOnce(column, metrics.shellWidth, metrics.targetLeft, placed);
  }

  box.style.width = "100%";
  box.style.maxWidth = "100%";
  box.style.minWidth = "0";
  box.style.marginLeft = "0";
  box.style.marginRight = "0";
  box.style.paddingLeft = "0";
  box.style.paddingRight = "0";
  box.style.boxSizing = "border-box";
  if (mode === "double") {
    box.style.setProperty("display", "grid", "important");
    box.style.setProperty("grid-template-columns", "minmax(0, 1fr) minmax(0, 1fr)", "important");
    box.style.setProperty("column-gap", "20px", "important");
    box.style.setProperty("row-gap", "14px", "important");
  }
}

/**
 * 清掉谷歌常见左侧固定 padding，不定宽（避免祖先与子级双重偏移）。
 * @param {Document} document
 */
function neutralizeGoogleLeftBias(document) {
  for (const id of ["cnt", "center_col", "rcnt", "searchform", "appbar", "sfcnt", "main", "content_left", "head", "hdtb", "slim_appbar"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    stampCentered(el);
    el.style.setProperty("padding-left", "0", "important");
    el.style.setProperty("padding-right", "0", "important");
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("left", "auto", "important");
    el.style.setProperty("right", "auto", "important");
    el.style.setProperty("transform", "none", "important");
  }
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
  for (const id of ["searchform", "appbar", "slim_appbar", "sfcnt", "sf", "head", "s_tab", "hdtb", "hdtbSum"]) {
    push(document.getElementById(id));
  }
  push(document.querySelector("form[role='search']")?.closest("#searchform, #sf, #sfcnt"));
  return bands;
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
 * 先清左边距，再按元素当前左缘与目标左缘的差值校正（不依赖父级测量）。
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
  el.style.setProperty("width", `${widthPx}px`, "important");
  el.style.setProperty("max-width", `${widthPx}px`, "important");
  el.style.setProperty("min-width", "0", "important");
  el.style.setProperty("padding-left", "0", "important");
  el.style.setProperty("padding-right", "0", "important");
  el.style.setProperty("box-sizing", "border-box", "important");
  el.style.setProperty("float", "none", "important");
  el.style.setProperty("transform", "none", "important");
  el.style.setProperty("right", "auto", "important");

  if (position === "fixed" || position === "sticky") {
    el.style.setProperty("left", `${targetLeft}px`, "important");
    el.style.setProperty("margin-left", "0", "important");
    el.style.setProperty("margin-right", "0", "important");
    return;
  }

  el.style.setProperty("left", "auto", "important");
  el.style.setProperty("margin-left", "0", "important");
  el.style.setProperty("margin-right", "auto", "important");
  // 强制读布局，用当前左缘与目标的差值一次校正
  const currentLeft = typeof el.getBoundingClientRect === "function"
    ? el.getBoundingClientRect().left
    : 0;
  const delta = Math.round(targetLeft - currentLeft);
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
  for (const el of document.querySelectorAll("[data-bsp-centered]")) {
    for (const prop of CENTERED_STYLE_PROPS) {
      el.style.removeProperty(prop);
    }
    delete el.dataset.bspCentered;
  }
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
  const root = resolveResultsWatchRoot(document);
  if (!root) return noop;

  let timer = 0;
  let muteDepth = 0;
  const clearTimer = () => {
    if (!timer) return;
    (globalThis.clearTimeout ?? clearTimeout)(timer);
    timer = 0;
  };
  const observer = new MutationObserver((records) => {
    if (muteDepth > 0) return;
    if (document.documentElement.dataset[RELAYOUT_FLAG]) return;
    if (document.documentElement.dataset[DOM_MUTE_FLAG]) return;
    if (records.every(isOwnDomMutation)) return;
    if (timer) return;
    timer = (globalThis.setTimeout ?? setTimeout)(() => {
      timer = 0;
      onChange();
    }, 120);
  });
  observer.observe(root, { childList: true, subtree: true });
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
        observer.takeRecords?.();
        clearTimer();
        muteDepth -= 1;
        if (muteDepth === 0) delete document.documentElement.dataset[DOM_MUTE_FLAG];
      }
    },
    dispose() {
      observer.disconnect();
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
  if (el.classList?.contains?.("bsp-hl")) return true;
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
  }
}

/**
 * @param {object} prefs
 */
function normalizeBootPrefs(prefs) {
  return {
    columnMode: prefs.columnMode ?? DEFAULT_PREFS.columnMode,
    highlight: false,
    autoPage: prefs.autoPage ?? DEFAULT_PREFS.autoPage,
  };
}

/**
 * @param {Document} document
 */
function visibleAside(document) {
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
  const view = el.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") return true;
  const style = view.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function measureViewport() {
  const width = globalThis.innerWidth;
  return typeof width === "number" && width > 0 ? width : undefined;
}
