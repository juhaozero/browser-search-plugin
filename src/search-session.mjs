const PAGE_SIZE = 10;
const MAX_APPENDED_PAGES = 10;

/**
 * @param {string} url
 */
export function isDesktopWebSearch(url) {
  const parsed = readUrl(url);
  if (!parsed) return false;
  if (isGoogleWeb(parsed)) return true;
  if (isBingWeb(parsed)) return true;
  return false;
}

/**
 * @param {string} url
 * @param {Document} [document] 当前已加载的一页；必应每页条数不固定，只能读它的「下一页」链接
 * @returns {string | null}
 */
export function nextPageUrl(url, document) {
  const parsed = readUrl(url);
  if (!parsed || !isDesktopWebSearch(url)) return null;
  if (isBingWeb(parsed)) {
    const href = document?.querySelector("a.sb_pagN[href]")?.getAttribute("href");
    if (href) return new URL(href, parsed).toString();
    const first = Number(parsed.searchParams.get("first") || "1");
    parsed.searchParams.set("first", String(first + PAGE_SIZE));
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
      const host = box.parentElement?.hasAttribute("data-bsp-results-host")
        ? box.parentElement
        : null;
      box.remove();
      host?.remove();
    }
    if (root) scrubOriginComments(root);
    else {
      for (const id of ["rso", "search", "center_col", "b_results"]) {
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
    // 必应结果根是 ol：不能直接塞 div，用 li 宿主包一层，避免浏览器「修正」DOM
    if (root.tagName === "OL" || root.tagName === "UL") {
      const host = document.createElement("li");
      host.setAttribute("data-bsp-results-host", "1");
      host.style.setProperty("list-style", "none", "important");
      host.style.setProperty("margin", "0", "important");
      host.style.setProperty("padding", "0", "important");
      host.style.setProperty("display", "block", "important");
      host.style.setProperty("width", "100%", "important");
      host.style.setProperty("max-width", "100%", "important");
      host.appendChild(box);
      root.insertBefore(host, root.firstChild);
    } else {
      root.insertBefore(box, root.firstChild);
    }
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
  if (isGoogleWeb(parsed)) return googleEngine;
  if (isBingWeb(parsed)) return bingEngine;
  return null;
}

const googleEngine = {
  name: "google",
  resultsRoot(document) {
    return document.getElementById("rso") ?? document.getElementById("search");
  },
  organicItems(root) {
    return [...root.querySelectorAll(
      "#bsp-results > .g, #bsp-results > .tF2Cxc, #rso .g, #rso .tF2Cxc",
    )].filter((element) => {
      if (!isGoogleOrganic(element)) return false;
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

const bingEngine = {
  name: "bing",
  resultsRoot(document) {
    return document.getElementById("b_results");
  },
  organicItems(root) {
    return [...root.querySelectorAll("#bsp-results > li.b_algo, #b_results > li.b_algo")].filter(isBingOrganic);
  },
  itemHref(item) {
    return bingTargetUrl(item.querySelector("h2 a[href]")?.getAttribute("href") ?? "");
  },
};

/**
 * 必应结果链接是 /ck/a 跳转，追踪参数每页都变；u=a1<base64url> 才是真实地址，用它去重。
 * @param {string} href
 */
function bingTargetUrl(href) {
  if (!href) return "";
  try {
    const parsed = new URL(href, "https://www.bing.com");
    const encoded = parsed.pathname === "/ck/a" ? parsed.searchParams.get("u") : null;
    if (!encoded?.startsWith("a1")) return href;
    const base64 = encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  } catch {
    return href;
  }
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
 * @param {Element} element
 */
function isBingOrganic(element) {
  if (element.closest(".b_ad, .b_adTop, .b_adBottom")) return false;
  if (element.querySelector(".b_adSlug, .b_adProvider")) return false;
  return element.querySelector("h2 a[href]") !== null;
}

/**
 * @param {URL} url
 */
function isGoogleWeb(url) {
  if (!/^(www\.)?google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/i.test(url.hostname)) return false;
  if (url.pathname !== "/search") return false;
  if (!url.searchParams.get("q")) return false;
  if (url.searchParams.has("tbm")) return false;
  const udm = url.searchParams.get("udm");
  if (udm && udm !== "14") return false;
  return true;
}

/**
 * @param {URL} url
 */
function isBingWeb(url) {
  if (!/^(www\.|cn\.)?bing\.com$/.test(url.hostname)) return false;
  if (url.pathname !== "/search") return false;
  return Boolean(url.searchParams.get("q"));
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
