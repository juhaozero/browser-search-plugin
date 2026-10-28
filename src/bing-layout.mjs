import { isElement, stampCentered } from "./layout-dom.mjs";

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

export { hideBingSideRails, stackBingFactRows };
