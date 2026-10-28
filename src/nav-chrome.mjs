import { isElement, placeAtViewportCenter, placedSignature, rectOf, stampCentered } from "./layout-dom.mjs";
import { BING_NAV_TAB_SELECTOR, LAYOUT_SHELL_IDS } from "./layout-constants.mjs";
import { alignGoogleSearchField } from "./search-field.mjs";
import { isOwnDomElement } from "./layout-dom.mjs";

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
const NAV_BAND_STOP_IDS = new Set([
  "cnt", "main", "rcnt", "center_col", "search", "gsr", "b_content",
  // 已由 placeHeader 定壳的顶栏：导航带停在其内部，拉满宿主即可与搜索栏对齐
  "appbar", "slim_appbar", "searchform", "sfcnt", "sf", "b_header",
]);

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
 * @param {ReturnType<typeof import("./shell-layout.mjs").layoutMetrics>} metrics
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

/**
 * 结果条数。已在居中壳内就跟着壳走，只留出和第一条结果的间距。
 * 壳外（旧版 #b_mcw 上面）才单独用 margin-left 对齐，并且不动 position / width。
 * @param {HTMLElement} el
 * @param {ReturnType<typeof import("./shell-layout.mjs").layoutMetrics>} metrics
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

export { collectHeaderBands, placeBingResultCount, placeNavBands, refreshChromeLayout, sanitizeNavChrome };
