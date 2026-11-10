import { DUCKDUCKGO_HOST } from "./search-hosts.mjs";

const RESULTS_LIST = "ol.react-results--main";
const ORGANIC_ITEM = 'li[data-layout="organic"]';
const TITLE_LINK = 'a[data-testid="result-title-a"][href]';

export function isDuckDuckGoWeb(url) {
  return url.protocol === "https:" && url.hostname === DUCKDUCKGO_HOST && url.pathname === "/"
    && Boolean(url.searchParams.get("q")?.trim())
    && ["", "web"].includes(url.searchParams.get("ia") ?? "") && !url.searchParams.get("iax");
}

export function duckDuckGoResultsList(document) {
  return document.querySelector(RESULTS_LIST);
}

export function duckDuckGoTitleLink(item) {
  return item.matches(ORGANIC_ITEM) ? item.querySelector(TITLE_LINK) : null;
}

export function createDuckDuckGoSession(document, prefs) {
  let columnMode = prefs.columnMode ?? "single-center";
  let autoPage = prefs.autoPage ?? true;
  let appendedPages = 0;

  function items() {
    return [...document.querySelectorAll(`${RESULTS_LIST} > ${ORGANIC_ITEM}`)].filter(duckDuckGoTitleLink);
  }

  function nextControl() {
    const button = document.querySelector("button#more-results");
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true"
      || button.closest("[hidden]") || button.checkVisibility?.() === false) return null;
    return button;
  }

  async function loadNext(button, signal) {
    const timeout = AbortSignal.timeout(15000);
    const waitSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    waitSignal.throwIfAborted();
    const seen = new Set(items().map(item => duckDuckGoTitleLink(item).href));
    // DuckDuckGo owns the cursor and renders each batch into the existing React list.
    button.click();
    waitSignal.throwIfAborted();
    const added = await new Promise((resolve, reject) => {
      const stop = () => {
        clearInterval(timer);
        waitSignal.removeEventListener("abort", abort);
      };
      const abort = () => {
        stop();
        reject(waitSignal.reason);
      };
      const check = () => {
        const fresh = new Set(items().map(item => duckDuckGoTitleLink(item).href).filter(href => !seen.has(href)));
        if (!fresh.size) return;
        stop();
        resolve(fresh.size);
      };
      const timer = setInterval(check, 100);
      waitSignal.addEventListener("abort", abort, { once: true });
      check();
    });
    appendedPages += 1;
    return { added, stopped: false };
  }

  return {
    engine: "duckduckgo",
    get items() { return items(); },
    get autoPage() { return autoPage; },
    get appendedPages() { return appendedPages; },
    get layoutMode() { return columnMode === "original" ? null : columnMode; },
    nextControl,
    loadNext,
    apply(next) {
      if (next.columnMode) columnMode = next.columnMode;
      if (typeof next.autoPage === "boolean") autoPage = next.autoPage;
    },
    // The stylesheet lays out native list items in place, including newly rendered batches.
    refresh() {},
  };
}
