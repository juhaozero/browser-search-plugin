import { createSearchSession, isDesktopWebSearch } from "./search-session.mjs";

const DEFAULT_PREFS = {
  columnMode: "single-center",
  highlight: true,
  autoPage: false,
};

const CENTER_WIDTH = 680;

/**
 * @param {Document} document
 * @param {string} url
 * @param {{ viewportWidth?: number, parentLeft?: number }} [layout]
 */
export function bootBaiduPage(document, url, layout = {}) {
  const parsed = readUrl(url);
  if (!parsed || parsed.hostname !== "www.baidu.com" || !isDesktopWebSearch(url)) return null;
  const session = createSearchSession(document, url, DEFAULT_PREFS);
  const box = document.getElementById("bsp-results");
  if (box) {
    alignSingleCenter(
      box,
      layout.viewportWidth ?? measureViewport(),
      layout.parentLeft ?? measureParentLeft(box),
    );
  }
  return session;
}

/**
 * @param {HTMLElement} box
 * @param {number | undefined} viewportWidth
 * @param {number | undefined} parentLeft
 */
export function alignSingleCenter(box, viewportWidth, parentLeft) {
  if (box.dataset.mode !== "single-center") return;
  if (!viewportWidth || viewportWidth <= 0 || parentLeft == null) return;
  const width = Math.min(CENTER_WIDTH, Math.max(0, viewportWidth - 32));
  const targetLeft = Math.max(16, (viewportWidth - width) / 2);
  box.style.width = `${width}px`;
  box.style.marginLeft = `${targetLeft - parentLeft}px`;
}

if (typeof location !== "undefined" && typeof document !== "undefined" && location.href) {
  bootBaiduPage(document, location.href);
}

/**
 * @param {HTMLElement} box
 */
function measureParentLeft(box) {
  const parent = box.parentElement;
  if (!parent || typeof parent.getBoundingClientRect !== "function") return undefined;
  const rect = parent.getBoundingClientRect();
  const view = parent.ownerDocument?.defaultView;
  const style = view && typeof view.getComputedStyle === "function" ? view.getComputedStyle(parent) : null;
  const border = style ? Number.parseFloat(style.borderLeftWidth) || 0 : 0;
  const padding = style ? Number.parseFloat(style.paddingLeft) || 0 : 0;
  return rect.left + border + padding;
}

function measureViewport() {
  const width = globalThis.innerWidth;
  return typeof width === "number" && width > 0 ? width : undefined;
}

/**
 * @param {string} url
 * @returns {URL | null}
 */
function readUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
