const PAGE_SIZE = 10;
const MAX_APPENDED_PAGES = 10;

const VERTICAL_BAIDU_TN = new Set(["news", "video", "image"]);

/**
 * @param {string} url
 */
export function isDesktopWebSearch(url) {
  const parsed = readUrl(url);
  if (!parsed) return false;
  if (isBaiduWeb(parsed)) return true;
  if (isGoogleWeb(parsed)) return true;
  return false;
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function nextPageUrl(url) {
  const parsed = readUrl(url);
  if (!parsed || !isDesktopWebSearch(url)) return null;
  if (isBaiduWeb(parsed)) {
    const pn = Number(parsed.searchParams.get("pn") || "0");
    parsed.searchParams.set("pn", String(pn + PAGE_SIZE));
    return parsed.toString();
  }
  if (isGoogleWeb(parsed)) {
    const start = Number(parsed.searchParams.get("start") || "0");
    parsed.searchParams.set("start", String(start + PAGE_SIZE));
    return parsed.toString();
  }
  return null;
}

/**
 * @param {Document} document
 * @param {string} url
 * @param {{ columnMode?: string, autoPage?: boolean }} prefs
 */
export function createSearchSession(document, url, prefs) {
  const engine = detectEngine(url);
  if (!engine) throw new Error("不是桌面版网页搜索");
  const state = {
    columnMode: prefs.columnMode ?? "single-center",
    autoPage: prefs.autoPage ?? true,
  };
  /** @type {WeakMap<Element, Comment>} */
  const origins = new WeakMap();
  let appendedPages = 0;

  layout();

  return {
    get appendedPages() {
      return appendedPages;
    },
    get autoPage() {
      return state.autoPage;
    },
    get engine() {
      return engine.name;
    },
    ingest(nextDocument) {
      if (!state.autoPage || appendedPages >= MAX_APPENDED_PAGES) return { added: 0, stopped: true };
      const known = new Set(listOrganic(document).map((item) => engine.itemHref(item)));
      const fresh = listOrganic(nextDocument).filter((item) => {
        const href = engine.itemHref(item);
        return href !== "" && !known.has(href);
      });
      if (fresh.length === 0) return { added: 0, stopped: true };
      const dest = document.getElementById("bsp-results") ?? engine.resultsRoot(document);
      if (!dest) return { added: 0, stopped: true };
      for (const item of fresh) dest.appendChild(document.importNode(item, true));
      appendedPages += 1;
      return { added: fresh.length, stopped: false };
    },
    apply(next) {
      if (next.columnMode) state.columnMode = next.columnMode;
      if (typeof next.autoPage === "boolean") state.autoPage = next.autoPage;
      layout();
    },
    /** 引擎 DOM 有新结果时重新收纳，不改偏好 */
    refresh() {
      layout();
    },
    /** 还原原生结果 DOM，避免 SPA 反复 boot 时 #bsp-results 与 origin 注释堆积 */
    dispose() {
      restoreOriginal();
      appendedPages = 0;
    },
  };

  function layout() {
    switch (state.columnMode) {
      case "original":
        restoreOriginal();
        break;
      case "single":
      case "single-center":
      case "double":
        moveResults(state.columnMode);
        break;
      default: {
        const unknown = state.columnMode;
        throw new Error(`未知列模式: ${unknown}`);
      }
    }
  }

  function moveResults(mode) {
    const root = engine.resultsRoot(document);
    if (!root) return;
    const pending = listOrganic(document).filter((item) => !document.getElementById("bsp-results")?.contains(item));
    for (const item of pending) rememberOrigin(item);
    const box = ensureBox(root);
    box.dataset.mode = mode;
    for (const item of pending) box.appendChild(item);
  }

  function restoreOriginal() {
    const box = document.getElementById("bsp-results");
    const root = engine.resultsRoot(document);
    if (box) {
      const kids = [...box.children];
      for (const item of kids) {
        const placeholder = origins.get(item);
        if (placeholder?.parentNode) {
          placeholder.parentNode.insertBefore(item, placeholder);
          placeholder.remove();
          origins.delete(item);
          continue;
        }
        if (root) root.appendChild(item);
        else item.remove();
        origins.delete(item);
      }
      box.remove();
    }
    // 清掉遗留的 bsp-origin 注释，防止 SPA 反复 boot 堆积（只扫结果容器，不扫整页）
    if (root) scrubOriginComments(root);
    else {
      for (const id of ["content_left", "rso", "search", "center_col"]) {
        const el = document.getElementById(id);
        if (el) scrubOriginComments(el);
      }
    }
  }

  /**
   * @param {ParentNode | null} scope
   */
  function scrubOriginComments(scope) {
    if (!scope) return;
    const doc = scope.nodeType === 9 ? scope : scope.ownerDocument;
    if (!doc || typeof doc.createTreeWalker !== "function") {
      scrubOriginCommentsFallback(scope);
      return;
    }
    const walker = doc.createTreeWalker(scope, 128 /* NodeFilter.SHOW_COMMENT */);
    /** @type {Comment[]} */
    const doomed = [];
    let node = walker.nextNode();
    while (node) {
      if (String(node.data ?? "").includes("bsp-origin")) doomed.push(/** @type {Comment} */ (node));
      node = walker.nextNode();
    }
    for (const comment of doomed) comment.remove();
  }

  /**
   * @param {ParentNode | null} scope
   */
  function scrubOriginCommentsFallback(scope) {
    if (!scope?.childNodes) return;
    for (const child of [...scope.childNodes]) {
      if (child.nodeType === 8 && String(child.data ?? "").includes("bsp-origin")) {
        child.remove();
        continue;
      }
      if (child.nodeType === 1) scrubOriginCommentsFallback(child);
    }
  }

  function ensureBox(root) {
    const existing = document.getElementById("bsp-results");
    if (existing) return existing;
    const box = document.createElement("div");
    box.id = "bsp-results";
    root.insertBefore(box, root.firstChild);
    return box;
  }

  function rememberOrigin(item) {
    if (origins.has(item) || !item.parentNode) return;
    const placeholder = item.ownerDocument.createComment("bsp-origin");
    item.parentNode.insertBefore(placeholder, item);
    origins.set(item, placeholder);
  }

  function listOrganic(root) {
    return engine.organicItems(root);
  }
}

/**
 * @param {string} url
 */
function detectEngine(url) {
  const parsed = readUrl(url);
  if (!parsed) return null;
  if (isBaiduWeb(parsed)) return baiduEngine;
  if (isGoogleWeb(parsed)) return googleEngine;
  return null;
}

const baiduEngine = {
  name: "baidu",
  resultsRoot(document) {
    return document.getElementById("content_left");
  },
  organicItems(root) {
    return [...root.querySelectorAll("#bsp-results > .c-container, #content_left > .c-container")].filter(isBaiduOrganic);
  },
  itemHref(item) {
    return item.querySelector("h3 a")?.getAttribute("href") ?? "";
  },
};

const googleEngine = {
  name: "google",
  resultsRoot(document) {
    return document.getElementById("rso") ?? document.getElementById("search");
  },
  organicItems(root) {
    // 现代谷歌常无 .g，结果块是 .tF2Cxc；旧版仍可能是 .g
    return [...root.querySelectorAll(
      "#bsp-results > .g, #bsp-results > .tF2Cxc, #rso .g, #rso .tF2Cxc",
    )].filter((element) => {
      if (!isGoogleOrganic(element)) return false;
      // 避免嵌套重复（如 .g 内再套 .g / .tF2Cxc）
      if (element.parentElement?.closest(".g, .tF2Cxc")) return false;
      return true;
    });
  },
  itemHref(item) {
    const heading = item.querySelector("h3");
    const link = heading?.querySelector("a") ?? heading?.closest("a") ?? item.querySelector("a[href]");
    return link?.getAttribute("href") ?? "";
  },
};

/**
 * @param {Element} element
 */
function isBaiduOrganic(element) {
  return element.classList.contains("c-container")
    && element.querySelector(".ec-tuiguang") === null
    && element.querySelector("h3 a[href]") !== null;
}

/**
 * @param {Element} element
 */
function isGoogleOrganic(element) {
  const isLegacy = element.classList.contains("g");
  const isModern = element.classList.contains("tF2Cxc");
  if (!isLegacy && !isModern) return false;
  if (element.closest("#tads, #bottomads, #tadsb, #rhs, .uEierd, [data-text-ad], .kp-wholepage")) return false;
  if (element.querySelector(".related-question-pair")) return false;
  if (!element.querySelector("h3") || !element.querySelector("a[href]")) return false;
  return true;
}

/**
 * @param {URL} url
 */
function isBaiduWeb(url) {
  if (url.hostname !== "www.baidu.com") return false;
  if (url.pathname !== "/s") return false;
  if (!url.searchParams.get("wd")) return false;
  const tn = url.searchParams.get("tn");
  if (tn && VERTICAL_BAIDU_TN.has(tn)) return false;
  return true;
}

/**
 * @param {URL} url
 */
function isGoogleWeb(url) {
  if (!/^(www\.)?google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/.test(url.hostname)) return false;
  if (url.pathname !== "/search") return false;
  if (!url.searchParams.get("q")) return false;
  if (url.searchParams.has("tbm")) return false;
  const udm = url.searchParams.get("udm");
  if (udm && udm !== "14") return false;
  return true;
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
