import { createSearchSession, isDesktopWebSearch } from "./search-session.mjs";
import { createAutoPager, fetchHtmlDocument } from "./auto-page.mjs";
import { DEFAULT_PREFS, createChromePrefsStore } from "./preferences.mjs";

export { DEFAULT_PREFS };

const CENTER_WIDTH = 680;

/**
 * @param {Document} document
 * @param {string} url
 * @param {{ viewportWidth?: number, parentLeft?: number }} [layout]
 * @param {{
 *   prefs?: { columnMode?: string, highlight?: boolean, autoPage?: boolean },
 *   prefsStore?: { load: () => Promise<object>, save?: Function, subscribe?: Function },
 *   fetchDocument?: (url: string) => Promise<Document>,
 *   attachScroll?: boolean,
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
  const pager = createAutoPager({
    document,
    session,
    url,
    enabled: prefs.autoPage,
    fetchDocument: deps.fetchDocument ?? fetchHtmlDocument,
  });
  if (deps.attachScroll !== false) attachScroll(document, pager);

  const applyPrefs = (next) => {
    const normalized = normalizeBootPrefs(next);
    session.apply(normalized);
    pager.setEnabled(normalized.autoPage);
    realign(document, layout);
  };

  let unsubscribe = () => {};
  if (store?.subscribe) unsubscribe = store.subscribe(applyPrefs);

  return { session, pager, applyPrefs, dispose: unsubscribe };
}

/**
 * @param {HTMLElement} box
 * @param {number | undefined} viewportWidth
 * @param {number | undefined} parentLeft
 */
export function alignSingleCenter(box, viewportWidth, parentLeft) {
  if (box.dataset.mode !== "single-center") {
    box.style.width = "";
    box.style.marginLeft = "";
    return;
  }
  if (!viewportWidth || viewportWidth <= 0 || parentLeft == null) return;
  const width = Math.min(CENTER_WIDTH, Math.max(0, viewportWidth - 32));
  const targetLeft = Math.max(16, (viewportWidth - width) / 2);
  box.style.width = `${width}px`;
  box.style.marginLeft = `${targetLeft - parentLeft}px`;
}

/**
 * @param {Document} document
 * @param {{ check: () => Promise<unknown> }} pager
 */
export function attachScroll(document, pager) {
  const view = document.defaultView;
  if (!view || typeof view.addEventListener !== "function") return;
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      void pager.check();
    });
  };
  view.addEventListener("scroll", onScroll, { passive: true });
  void pager.check();
}

/**
 * @param {Document} document
 * @param {{ viewportWidth?: number, parentLeft?: number }} layout
 */
function realign(document, layout) {
  const box = document.getElementById("bsp-results");
  if (!box) return;
  alignSingleCenter(
    box,
    layout.viewportWidth ?? measureViewport(),
    layout.parentLeft ?? measureParentLeft(box),
  );
}

/**
 * @param {object} prefs
 */
function normalizeBootPrefs(prefs) {
  return {
    columnMode: prefs.columnMode ?? DEFAULT_PREFS.columnMode,
    highlight: prefs.highlight ?? DEFAULT_PREFS.highlight,
    autoPage: prefs.autoPage ?? DEFAULT_PREFS.autoPage,
  };
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
