import { nextPageUrl } from "./search-session.mjs";

const NEAR_BOTTOM_PX = 800;
const FAIL_TIP_MS = 2000;

/**
 * @param {{
 *   document: Document,
 *   session: {
 *     ingest: (doc: Document) => { added: number, stopped: boolean },
 *     appendedPages: number,
 *     autoPage: boolean,
 *   },
 *   url: string,
 *   enabled?: boolean,
 *   fetchDocument: (url: string) => Promise<Document>,
 *   nearBottomPx?: number,
 *   failTipMs?: number,
 *   schedule?: (fn: () => void, ms: number) => unknown,
 * }} options
 */
export function createAutoPager(options) {
  const document = options.document;
  const session = options.session;
  const nearBottomPx = options.nearBottomPx ?? NEAR_BOTTOM_PX;
  const failTipMs = options.failTipMs ?? FAIL_TIP_MS;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));

  let enabled = options.enabled ?? true;
  let currentUrl = options.url;
  let busy = false;
  let stopped = false;
  let needLeaveBottom = false;
  let tip = null;
  let failClearHandle = null;

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) clearTip();
    },
    get stopped() {
      return stopped;
    },
    get currentUrl() {
      return currentUrl;
    },
    async check(metrics) {
      if (!enabled || !session.autoPage || stopped || busy) return { fetched: false };
      const near = isNearBottom(document, metrics, nearBottomPx);
      if (!near) {
        needLeaveBottom = false;
        return { fetched: false };
      }
      if (needLeaveBottom) return { fetched: false };
      return loadNext();
    },
    dispose() {
      if (failClearHandle != null && typeof clearTimeout === "function") clearTimeout(failClearHandle);
      clearTip();
    },
  };

  async function loadNext() {
    if (session.appendedPages >= 10) {
      stopped = true;
      clearTip();
      return { fetched: false, stopped: true };
    }
    const next = nextPageUrl(currentUrl);
    if (!next) {
      stopped = true;
      clearTip();
      return { fetched: false, stopped: true };
    }
    busy = true;
    showTip("加载中");
    try {
      const nextDocument = await options.fetchDocument(next);
      if (!session.autoPage) {
        clearTip();
        return { fetched: false };
      }
      const result = session.ingest(nextDocument);
      if (!session.autoPage) {
        clearTip();
        return { fetched: false };
      }
      if (result.added > 0) currentUrl = next;
      if (result.stopped || session.appendedPages >= 10) stopped = true;
      clearTip();
      return { fetched: result.added > 0, ...result };
    } catch {
      showTip("加载失败");
      needLeaveBottom = true;
      if (failClearHandle != null && typeof clearTimeout === "function") clearTimeout(failClearHandle);
      failClearHandle = schedule(() => {
        clearTip();
        failClearHandle = null;
      }, failTipMs);
      return { fetched: false, failed: true };
    } finally {
      busy = false;
    }
  }

  function showTip(text) {
    const node = ensureTip();
    node.textContent = text;
    node.hidden = false;
  }

  function clearTip() {
    if (!tip) return;
    tip.textContent = "";
    tip.hidden = true;
  }

  function ensureTip() {
    if (tip?.isConnected) return tip;
    tip = document.getElementById("bsp-status");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "bsp-status";
      tip.setAttribute("aria-live", "polite");
      tip.hidden = true;
      const page = document.getElementById("page");
      if (page?.parentNode) page.parentNode.insertBefore(tip, page);
      else document.body.appendChild(tip);
    }
    return tip;
  }
}

/**
 * @param {Document} document
 * @param {{ scrollY?: number, viewportHeight?: number, listBottom?: number } | undefined} metrics
 * @param {number} nearBottomPx
 */
export function isNearBottom(document, metrics, nearBottomPx = NEAR_BOTTOM_PX) {
  if (metrics && typeof metrics.listBottom === "number" && typeof metrics.viewportHeight === "number") {
    const scrollY = metrics.scrollY ?? 0;
    return metrics.listBottom - (scrollY + metrics.viewportHeight) <= nearBottomPx;
  }
  const list = document.getElementById("bsp-results") ?? document.getElementById("content_left");
  if (!list || typeof list.getBoundingClientRect !== "function") return false;
  const viewport = document.defaultView?.innerHeight ?? metrics?.viewportHeight;
  if (!viewport) return false;
  return list.getBoundingClientRect().bottom - viewport <= nearBottomPx;
}

/**
 * @param {string} url
 * @returns {Promise<Document>}
 */
export async function fetchHtmlDocument(url) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`取下一页失败: ${response.status}`);
  const html = await response.text();
  return new DOMParser().parseFromString(html, "text/html");
}
