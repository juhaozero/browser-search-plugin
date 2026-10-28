import { nextPageUrl } from "./search-session.mjs";
import { DEFAULT_LOCALE, normalizeLocale, t } from "./i18n.mjs";
import { DEFAULT_PREFS, normalizePrefs } from "./preferences.mjs";

const NEAR_BOTTOM_PX = DEFAULT_PREFS.nearBottomPx;

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
 *   locale?: string,
 *   prefs?: object,
 *   fetchDocument: (url: string, signal?: AbortSignal) => Promise<Document>,
 *   nearBottomPx?: number,
 *   mutate?: <T>(fn: () => T) => T,
 * }} options
 */
export function createAutoPager(options) {
  const document = options.document;
  const session = options.session;
  let config = normalizePrefs(options.prefs);
  let nearBottomPx = options.nearBottomPx ?? config.nearBottomPx;
  const mutate = options.mutate ?? ((fn) => fn());

  let enabled = options.enabled ?? true;
  let currentUrl = options.url;
  /** 最近接入的一页：下一页地址从它的分页链接读取。 */
  let currentDocument = document;
  let busy = false;
  let stopped = false;
  let disposed = false;
  let needLeaveBottom = false;
  let tip = null;
  let pageLimit = config.pagesPerBatch;
  let status = "loaded";
  let locale = normalizeLocale(options.locale ?? DEFAULT_LOCALE);
  const statusKeys = { loading: "pageLoading", failed: "pageFailed", limit: "pageLimit", end: "pageEnd" };
  /** @type {AbortController | null} */
  let inflight = null;

  const api = {
    get enabled() {
      return enabled;
    },
    setLocale(value) {
      if (disposed) return;
      locale = normalizeLocale(value);
      if (tip && !tip.hidden) renderStatus();
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) clearTip();
      else if (session.appendedPages || status !== "loaded") renderStatus();
    },
    setPrefs(next) {
      const previousBatch = config.pagesPerBatch;
      config = normalizePrefs(next);
      nearBottomPx = config.nearBottomPx;
      if (previousBatch !== config.pagesPerBatch || (status === "limit" && config.autoContinue)) {
        pageLimit = session.appendedPages + config.pagesPerBatch;
        if (status === "limit") { stopped = false; status = "loaded"; }
      }
      if (tip && !tip.hidden) renderStatus();
    },
    get stopped() {
      return stopped;
    },
    get currentUrl() {
      return currentUrl;
    },
    retry,
    continueLoading,
    async check(metrics) {
      if (disposed || !enabled || !session.autoPage || stopped || busy) return { fetched: false };
      const near = isNearBottom(document, metrics, nearBottomPx);
      if (!near) {
        needLeaveBottom = false;
        return { fetched: false };
      }
      if (needLeaveBottom) return { fetched: false };
      return loadNext();
    },
    dispose() {
      disposed = true;
      try {
        inflight?.abort?.();
      } catch {
        // ignore
      }
      inflight = null;
      removeTip();
    },
  };
  return api;

  function retry() {
    if (disposed || !enabled || !session.autoPage || busy || stopped) return Promise.resolve({ fetched: false });
    needLeaveBottom = false;
    return loadNext();
  }

  function continueLoading() {
    if (disposed || !enabled || !session.autoPage || busy || status !== "limit") return Promise.resolve({ fetched: false });
    pageLimit = session.appendedPages + config.pagesPerBatch;
    stopped = false;
    return retry();
  }

  async function loadNext() {
    if (disposed) return { fetched: false };
    if (session.appendedPages >= pageLimit) {
      stopped = true;
      showTip("limit");
      return { fetched: false, stopped: true };
    }
    const next = nextPageUrl(currentUrl, currentDocument);
    if (!next) {
      stopped = true;
      showTip("end");
      return { fetched: false, stopped: true };
    }
    busy = true;
    showTip("loading");
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    inflight = ac;
    try {
      const nextDocument = await options.fetchDocument(next, ac?.signal);
      if (disposed || !enabled || !session.autoPage) {
        clearTip();
        return { fetched: false };
      }
      const result = mutate(() => session.ingest(nextDocument));
      if (disposed || !enabled || !session.autoPage) {
        clearTip();
        return { fetched: false };
      }
      if (result.added > 0) {
        currentUrl = next;
        currentDocument = nextDocument;
      }
      if (config.autoContinue && session.appendedPages >= pageLimit) pageLimit += config.pagesPerBatch;
      stopped = result.stopped || session.appendedPages >= pageLimit;
      showTip(result.stopped ? "end" : stopped ? "limit" : "loaded");
      if (config.autoContinue && result.added > 0 && !stopped) queueMicrotask(() => { void api.check(); });
      return { ...result, fetched: result.added > 0, stopped };
    } catch (error) {
      if (disposed || !enabled || !session.autoPage || isAbortError(error)) return { fetched: false, failed: false };
      showTip("failed");
      needLeaveBottom = true;
      return { fetched: false, failed: true };
    } finally {
      if (inflight === ac) inflight = null;
      busy = false;
    }
  }

  function showTip(nextStatus) {
    status = nextStatus;
    renderStatus();
  }

  function renderStatus() {
    mutate(() => {
      const node = ensureTip();
      node.textContent = "";
      const message = document.createElement("span");
      message.className = "bsp-status-message";
      const count = t(locale, "pagesLoaded").replace("{count}", String(session.appendedPages));
      message.textContent = status === "loaded" ? count : `${t(locale, statusKeys[status])} · ${count}`;
      node.appendChild(message);
      if (status === "failed") addButton(node, t(locale, "pageRetry"), () => { void retry(); });
      if (status === "limit") addButton(node, t(locale, "pageMore"), () => { void continueLoading(); });
      if (session.appendedPages > 0) addButton(node, t(locale, "pageTop"), () => {
        document.defaultView?.scrollTo?.({ top: 0, behavior: "smooth" });
      });
      node.hidden = false;
    });
  }

  function addButton(node, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      // 搜索引擎会在外层代理点击事件，扩展按钮由自身处理。
      event.stopPropagation();
      onClick();
    });
    node.appendChild(button);
  }

  function clearTip() {
    if (!tip) return;
    tip.textContent = "";
    tip.hidden = true;
  }

  function removeTip() {
    clearTip();
    tip?.remove?.();
    tip = null;
    const orphan = document.getElementById("bsp-status");
    orphan?.remove?.();
  }

  function ensureTip() {
    if (tip?.isConnected) return tip;
    tip = document.getElementById("bsp-status");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "bsp-status";
      tip.setAttribute("aria-live", "polite");
      tip.setAttribute("aria-atomic", "true");
      tip.hidden = true;
      const page = document.getElementById("page")
        ?? document.getElementById("botstuff")
        ?? document.getElementById("nav")
        ?? document.getElementById("pnnext")?.closest("table")
        ?? document.getElementById("pnnext")
        ?? document.querySelector("#b_results > .b_pag");
      const anchor = page?.closest("li.b_pag") ?? page;
      if (anchor?.parentNode?.tagName === "OL" || anchor?.parentNode?.tagName === "UL") {
        // 必应分页位于列表内，状态区放在列表外以保持 HTML 结构合法。
        anchor.parentNode.after(tip);
      }
      else if (anchor?.parentNode) anchor.parentNode.insertBefore(tip, anchor);
      else document.body.appendChild(tip);
    }
    return tip;
  }
}

/**
 * @param {unknown} error
 */
function isAbortError(error) {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
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
  const list = document.getElementById("bsp-results")
    ?? document.getElementById("rso")
    ?? document.getElementById("search")
    ?? document.getElementById("b_results");
  if (!list || typeof list.getBoundingClientRect !== "function") return false;
  const viewport = document.defaultView?.innerHeight ?? metrics?.viewportHeight;
  if (!viewport) return false;
  return list.getBoundingClientRect().bottom - viewport <= nearBottomPx;
}

/**
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<Document>}
 */
export async function fetchHtmlDocument(url, signal) {
  const timeout = AbortSignal.timeout(15000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, { credentials: "include", signal: requestSignal });
  if (!response.ok) throw new Error(`取下一页失败: ${response.status}`);
  const html = await response.text();
  const document = new DOMParser().parseFromString(html, "text/html");
  if (!document.querySelector("#rso, #search, #b_results")) throw new Error("下一页未返回搜索结果，请稍后重试");
  return document;
}
