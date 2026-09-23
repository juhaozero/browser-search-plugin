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
  "top",
  "bottom",
  "grid-template-columns",
];

const ASIDE_IDS = ["rhs", "content_right"];
const RELAYOUT_FLAG = "bspRelayout";
/** 自身 DOM 改写期间屏蔽 MutationObserver，避免 refresh/搬移结果节点形成反馈环 */
const DOM_MUTE_FLAG = "bspDomMute";

const RESULTS_WATCH_IDS = ["rso", "search", "center_col", "content_left"];
/** 现代谷歌导航标签的稳定标记（jsname 在多次改版中保持不变） */
const NAV_TAB_JSNAME = "pxBnId";
/** 导航标签文本兜底：只在已知导航容器内匹配，避免误伤正文里同名的链接 */
const NAV_TAB_LABELS = new Set([
  "全部", "图片", "视频", "新闻", "短视频", "网页", "图书", "地图", "购物", "财经", "更多", "工具",
  "All", "Images", "Videos", "News", "Books", "Maps", "Shopping", "Finance", "More", "Tools",
]);
/** 导航带最大高度：超过说明上爬过头，命中的是整页容器而非单行导航 */
const NAV_BAND_MAX_HEIGHT = 96;
/** 上爬禁止越过的整页容器 */
const NAV_BAND_STOP_IDS = new Set(["cnt", "main", "rcnt", "center_col", "search", "gsr", "content_left"]);

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
  // 壳宽/模式未变时跳过清样式重排，避免 MutationObserver 触发时顶栏闪跳
  if (
    root.dataset.bspShellWidth === String(metrics.shellWidth)
    && root.dataset.bspColumnMode === mode
    && document.querySelector("[data-bsp-centered]")
  ) {
    return;
  }

  root.dataset[RELAYOUT_FLAG] = "1";
  try {
    clearCenteredLayout(document);
    applyShellLayout(document, box, metrics);
    root.dataset.bspShellWidth = String(metrics.shellWidth);
    root.dataset.bspColumnMode = mode;
    root.style.setProperty("--bsp-shell-width", `${metrics.shellWidth}px`);
    root.style.setProperty("--bsp-main-width", `${metrics.mainWidth}px`);
    root.style.setProperty("--bsp-target-left", `${metrics.targetLeft}px`);
  } finally {
    delete root.dataset[RELAYOUT_FLAG];
  }
}

/**
 * @param {string} mode
 * @param {number} viewportWidth
 */
export function contentWidth(mode, viewportWidth) {
  const target = mode === "double" ? DOUBLE_SHELL_MAX : SINGLE_SHELL_MAX;
  const usable = Math.max(280, viewportWidth - SIDE_GAP * 2);
  return Math.min(target, usable);
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

  neutralizePageLeftBias(document);

  /** @type {Set<HTMLElement>} */
  const placed = new Set();
  if (metrics.hasAside && rcnt && metrics.aside && metrics.asideInShell) {
    alignBandToTarget(rcnt, metrics.shellWidth, metrics.targetLeft);
    placed.add(rcnt);
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
    // 整页容器多为 grid：会把列宽夹到旧列宽（并因此整体偏右），恢复成普通块让壳真居中
    if (rcnt && !hasVisibleSibling(rcnt, column)) {
      stampCentered(rcnt);
      rcnt.style.setProperty("display", "block", "important");
      rcnt.style.setProperty("grid-template-columns", "none", "important");
    }
    placeShellOnce(column, metrics.shellWidth, metrics.targetLeft, placed);
    if (isBlockParent(column)) {
      // 普通块父级下交给 auto margin：浏览器在真实包含块（已扣滚动条）内居中，比手算 delta 准
      column.style.setProperty("left", "auto", "important");
      column.style.setProperty("margin-left", "auto", "important");
      column.style.setProperty("margin-right", "auto", "important");
    }
  }

  // 顶栏用 margin:auto 稳态居中（不用 left 像素追结果列，避免显示后反复跳动）
  for (const el of collectHeaderBands(document)) {
    placeBandOnce(el, metrics.shellWidth, metrics.targetLeft, placed);
  }
  placeNavBands(document, metrics.shellWidth, metrics.targetLeft, placed);

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
    box.style.setProperty("column-gap", `${CARD_COLUMN_GAP}px`, "important");
    box.style.setProperty("row-gap", `${CARD_GAP}px`, "important");
  }
}

/**
 * 清掉搜索引擎常见左侧固定 padding（不定宽，避免祖先与子级双重偏移）。
 * @param {Document} document
 */
function neutralizePageLeftBias(document) {
  for (const id of [
    "cnt", "center_col", "rcnt", "searchform", "appbar", "sfcnt", "main",
    "content_left", "head", "hdtb", "slim_appbar", "s_tab", "s_tab_inner",
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
  // 先放搜索区，导航交给 placeNavBands 强制处理
  for (const id of ["searchform", "appbar", "slim_appbar", "sfcnt", "sf", "head"]) {
    push(document.getElementById(id));
  }
  push(document.querySelector("form[role='search']")?.closest("#searchform, #sf, #sfcnt, #head"));
  return bands;
}

/**
 * 强制把导航条放到与结果列相同的壳宽/左缘。
 * 谷歌 #hdtb 常为 position:sticky，用 left 定位无效，必须改 relative 再按视口位移。
 * 现代谷歌的 #hdtb 是 0 高空壳，真实标签行在哈希类名容器里，需按内容定位。
 * @param {Document} document
 * @param {number} widthPx
 * @param {number} targetLeft
 * @param {Set<HTMLElement>} placed
 */
function placeNavBands(document, widthPx, targetLeft, placed) {
  /** @type {HTMLElement[]} */
  const aligned = [];
  /** @type {HTMLElement[]} */
  const candidates = [];
  const push = (el) => {
    if (!el || !(el instanceof HTMLElement) || candidates.includes(el)) return;
    if (!isNavBandVisible(el)) return;
    candidates.push(el);
  };
  for (const id of ["s_tab", "hdtb", "hdtbSum", "hdtb-msb", "hdtbMenus"]) {
    push(document.getElementById(id));
  }
  push(document.querySelector("#s_tab, .s_tab"));
  push(document.querySelector("#hdtb, #hdtbSum"));
  push(document.querySelector("#hdtb-msb"));

  // 只处理最外层，避免 hdtb 与 hdtb-msb 双重偏移
  const roots = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
  for (const el of roots) {
    alignBandToTarget(el, widthPx, targetLeft);
    placed.add(el);
    aligned.push(el);
  }

  // 兜底：按标签内容找到真实导航带，只做水平校正（不动宽度，避免破坏其网格列宽）
  const band = findNavTabBand(document);
  if (!band) return aligned;
  if (roots.some((el) => el === band || el.contains(band))) return aligned;
  if ([...placed].some((el) => el !== band && (el.contains(band) || band.contains(el)))) return aligned;
  shiftNavBand(band, targetLeft);
  placed.add(band);
  aligned.push(band);
  return aligned;
}

/**
 * 导航带是否真的有可见内容（现代谷歌 #hdtb 是 0 高空壳，写样式没有意义）。
 * @param {HTMLElement} el
 */
function isNavBandVisible(el) {
  const rect = rectOf(el);
  return rect.height >= 8 && rect.width >= 120;
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
  for (const el of document.querySelectorAll(`a[jsname="${NAV_TAB_JSNAME}"]`)) {
    if (el instanceof HTMLElement && isVisibleLink(el) && !isOwnDomElement(el)) tagged.push(el);
  }
  if (tagged.length >= 2) return tagged;

  // 兜底：只在已知导航容器内按文本匹配
  /** @type {HTMLElement[]} */
  const fallback = [];
  for (const el of document.querySelectorAll("#hdtb a, #s_tab a, .s_tab a")) {
    if (!(el instanceof HTMLElement)) continue;
    if (!NAV_TAB_LABELS.has((el.textContent ?? "").trim())) continue;
    if (!isVisibleLink(el) || isOwnDomElement(el)) continue;
    fallback.push(el);
  }
  return fallback;
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
 * 头部/导航稳态居中：定壳宽 + margin:auto，不写 left 像素。
 * 像素追赶（settleLeft）会在结果列回流后反复改位，是顶栏「每次跳一下」的主因。
 * @param {HTMLElement} el
 * @param {number} widthPx
 * @param {number} [_targetLeft] 保留参数以兼容旧调用方
 */
function alignBandToTarget(el, widthPx, _targetLeft) {
  stampCentered(el);
  const maxW = `min(${widthPx}px, calc(100vw - ${SIDE_GAP * 2}px))`;
  el.style.setProperty("position", "relative", "important");
  el.style.setProperty("top", "0", "important");
  el.style.setProperty("bottom", "auto", "important");
  el.style.setProperty("left", "auto", "important");
  el.style.setProperty("right", "auto", "important");
  el.style.setProperty("width", `${widthPx}px`, "important");
  el.style.setProperty("max-width", maxW, "important");
  el.style.setProperty("min-width", "0", "important");
  el.style.setProperty("padding-left", "0", "important");
  el.style.setProperty("padding-right", "0", "important");
  el.style.setProperty("margin-left", "auto", "important");
  el.style.setProperty("margin-right", "auto", "important");
  el.style.setProperty("box-sizing", "border-box", "important");
  el.style.setProperty("float", "none", "important");
  el.style.setProperty("transform", "none", "important");
  el.style.setProperty("overflow", "visible", "important");
}

/**
 * 导航带水平居中：保持自身布局，只用 auto margin 贴到视口中间。
 * @param {HTMLElement} el
 * @param {number} [_targetLeft]
 */
function shiftNavBand(el, _targetLeft) {
  stampCentered(el);
  el.style.setProperty("position", "relative", "important");
  el.style.setProperty("top", "0", "important");
  el.style.setProperty("bottom", "auto", "important");
  el.style.setProperty("left", "auto", "important");
  el.style.setProperty("right", "auto", "important");
  el.style.setProperty("margin-left", "auto", "important");
  el.style.setProperty("margin-right", "auto", "important");
  el.style.setProperty("float", "none", "important");
  el.style.setProperty("transform", "none", "important");
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
  for (const el of document.querySelectorAll("[data-bsp-centered]")) {
    for (const prop of CENTERED_STYLE_PROPS) {
      el.style.removeProperty(prop);
    }
    delete el.dataset.bspCentered;
  }
  const root = document.documentElement;
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

  const attach = (root) => {
    observer = new MutationObserver(onMutations);
    observer.observe(root, { childList: true, subtree: true });
  };

  const root = resolveResultsWatchRoot(document);
  if (root) {
    attach(root);
  } else {
    // 结果容器晚到时用有界轮询挂载，避免对 body 开 subtree 观察（易 OOM）
    findTimer = (globalThis.setInterval ?? setInterval)(() => {
      findAttempts += 1;
      const found = resolveResultsWatchRoot(document);
      if (found) {
        clearFindTimer();
        attach(found);
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
        observer?.takeRecords?.();
        clearTimer();
        muteDepth -= 1;
        if (muteDepth === 0) delete document.documentElement.dataset[DOM_MUTE_FLAG];
      }
    },
    dispose() {
      clearFindTimer();
      observer?.disconnect();
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
    if (!(child instanceof HTMLElement)) continue;
    if (!isDisplayed(child)) continue;
    if (rectOf(child).width >= 80) return true;
  }
  return false;
}
