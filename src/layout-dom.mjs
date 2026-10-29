import { SIDE_GAP } from "./layout-constants.mjs";

/**
 * 只清左右外边距。上边距留给页面自己，清掉会把结果列顶进导航。
 * @param {HTMLElement} el
 */
function clearHorizontalMargin(el) {
  el.style.setProperty("margin-left", "0", "important");
  el.style.setProperty("margin-right", "0", "important");
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
 * @param {HTMLElement} el
 */
function stampCentered(el) {
  el.dataset.bspCentered = "1";
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

export { clearHorizontalMargin, isDisplayed, isElement, measureViewport, placeAtViewportCenter, placedSignature, rectOf, stampCentered };

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
export { findLayoutShell };

/**
 * @param {Element | null | undefined} el
 */
function isOwnDomElement(el) {
  if (!el) return false;
  if (el.id?.startsWith("bsp-")) return true;
  if (typeof el.closest === "function") {
    if (el.closest("#bsp-results, #bsp-status, .bsp-site-search-wrap, .bsp-site-badge, .bsp-open-error")) return true;
  }
  return false;
}
export { isOwnDomElement };
