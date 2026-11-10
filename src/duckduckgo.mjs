import { DUCKDUCKGO_HOST } from "./search-hosts.mjs";

const RESULTS_LIST = "ol.react-results--main";
const ORGANIC_ITEM = 'li[data-layout="organic"]';
const TITLE_LINK = 'a[data-testid="result-title-a"][href]';
const MORE_RESULTS = "button#more-results";
const DUPLICATE = "data-bsp-duplicate-result";
// shortcut: DuckDuckGo's end-of-results message has no stable test ID.
const END_MESSAGE = ".uj_CxKzm9Q64HapimO_s";

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
  const duplicates = new Map();

  function items() {
    return [...document.querySelectorAll(`${RESULTS_LIST} > ${ORGANIC_ITEM}`)]
      .filter(item => !duplicates.has(item) && duckDuckGoTitleLink(item));
  }

  function nextControl() {
    const button = document.querySelector(MORE_RESULTS);
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true"
      || button.closest("[hidden]") || button.checkVisibility?.() === false) return null;
    return button;
  }

  function isAtEnd() {
    return !document.querySelector(MORE_RESULTS) && Boolean(document.querySelector(END_MESSAGE));
  }

  async function loadNext(button, signal) {
    const timeout = AbortSignal.timeout(15000);
    const waitSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    waitSignal.throwIfAborted();
    const before = new Set(items());
    const seen = new Set([...before].map(item => duckDuckGoTitleLink(item).href));
    // DuckDuckGo owns the cursor and renders each batch into the existing React list.
    button.click();
    waitSignal.throwIfAborted();
    const result = await new Promise((resolve, reject) => {
      let sawDuplicate = false;
      let sawLoading = false;
      const stop = () => {
        clearInterval(timer);
        waitSignal.removeEventListener("abort", abort);
      };
      const abort = () => {
        stop();
        if (sawDuplicate && waitSignal.reason?.name === "TimeoutError" && nextControl()) {
          resolve({ added: 0, stopped: false });
        }
        else reject(waitSignal.reason);
      };
      const check = () => {
        const current = items();
        const added = new Set(current.map(item => duckDuckGoTitleLink(item).href).filter(href => !seen.has(href))).size;
        const ended = isAtEnd() || (added > 0 && !document.querySelector(MORE_RESULTS));
        const more = document.querySelector(MORE_RESULTS);
        const loading = more?.disabled || more?.getAttribute("aria-disabled") === "true";
        sawLoading ||= loading;
        const retained = new Set(current.filter(item => before.has(item)).map(item => duckDuckGoTitleLink(item).href));
        const repeated = current.filter(item => {
          if (before.has(item)) return false;
          const href = duckDuckGoTitleLink(item).href;
          if (retained.has(href)) return true;
          retained.add(href);
          return false;
        });
        // Keep the React nodes in place so its next render can update or remove them.
        for (const item of repeated) {
          duplicates.set(item, duckDuckGoTitleLink(item).href);
          item.setAttribute(DUPLICATE, "");
        }
        sawDuplicate ||= repeated.length > 0;
        if (!added && !ended && !(sawDuplicate && sawLoading && nextControl())) return;
        stop();
        resolve({ added, stopped: ended });
      };
      const timer = setInterval(check, 100);
      waitSignal.addEventListener("abort", abort, { once: true });
      check();
    });
    if (result.added || !result.stopped) appendedPages += 1;
    return result;
  }

  return {
    engine: "duckduckgo",
    get items() { return items(); },
    get autoPage() { return autoPage; },
    get appendedPages() { return appendedPages; },
    get layoutMode() { return columnMode === "original" ? null : columnMode; },
    nextControl,
    isAtEnd,
    loadNext,
    apply(next) {
      if (next.columnMode) columnMode = next.columnMode;
      if (typeof next.autoPage === "boolean") autoPage = next.autoPage;
    },
    // The stylesheet lays out native list items in place, including newly rendered batches.
    refresh() {
      for (const [item, href] of duplicates) {
        if (item.isConnected && duckDuckGoTitleLink(item)?.href === href) continue;
        item.removeAttribute(DUPLICATE);
        duplicates.delete(item);
      }
    },
    dispose() {
      for (const item of duplicates.keys()) item.removeAttribute(DUPLICATE);
      duplicates.clear();
    },
  };
}
