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
 * @param {string} query
 */
export function highlightSegments(query) {
  return query.split(/[\s\p{P}]+/u).filter((part) => part.length > 0);
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
 * @param {{ columnMode?: string, highlight?: boolean, autoPage?: boolean }} prefs
 */
export function createSearchSession(document, url, prefs) {
  const state = {
    columnMode: prefs.columnMode ?? "single-center",
    highlight: prefs.highlight ?? true,
    autoPage: prefs.autoPage ?? true,
  };
  const segments = highlightSegments(queryFromUrl(url));
  /** @type {WeakMap<Element, { parent: Node, next: Node | null }>} */
  const origins = new WeakMap();
  let appendedPages = 0;

  layout();
  paint();

  return {
    get appendedPages() {
      return appendedPages;
    },
    ingest(nextDocument) {
      if (appendedPages >= MAX_APPENDED_PAGES) return { added: 0, stopped: true };
      const known = new Set(organicItems(document).map(itemHref));
      const fresh = organicItems(nextDocument).filter((item) => {
        const href = itemHref(item);
        return href !== "" && !known.has(href);
      });
      if (fresh.length === 0) return { added: 0, stopped: true };
      const dest = document.getElementById("bsp-results") ?? document.getElementById("content_left");
      if (!dest) return { added: 0, stopped: true };
      for (const item of fresh) dest.appendChild(document.importNode(item, true));
      appendedPages += 1;
      paint();
      return { added: fresh.length, stopped: false };
    },
    apply(next) {
      if (next.columnMode) state.columnMode = next.columnMode;
      if (typeof next.highlight === "boolean") state.highlight = next.highlight;
      if (typeof next.autoPage === "boolean") state.autoPage = next.autoPage;
      layout();
      paint();
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
    const left = document.getElementById("content_left");
    if (!left) return;
    const pending = [...left.children].filter(isOrganicItem);
    for (const item of pending) rememberOrigin(item);
    const box = ensureBox(left);
    box.dataset.mode = mode;
    for (const item of pending) box.appendChild(item);
  }

  function restoreOriginal() {
    const box = document.getElementById("bsp-results");
    const left = document.getElementById("content_left");
    if (!box || !left) return;
    const appended = [...box.children].filter((item) => !origins.has(item));
    for (const item of [...box.children]) {
      if (!origins.has(item)) continue;
      const origin = origins.get(item);
      if (origin.next && origin.next.parentNode === origin.parent) origin.parent.insertBefore(item, origin.next);
      else origin.parent.appendChild(item);
    }
    for (const item of appended) left.appendChild(item);
    box.remove();
  }

  function ensureBox(left) {
    const existing = document.getElementById("bsp-results");
    if (existing) return existing;
    const box = document.createElement("div");
    box.id = "bsp-results";
    left.insertBefore(box, left.firstChild);
    return box;
  }

  function rememberOrigin(item) {
    if (origins.has(item)) return;
    origins.set(item, { parent: item.parentNode, next: item.nextSibling });
  }

  function paint() {
    for (const item of organicItems(document)) {
      const title = item.querySelector("h3 a");
      const abstract = item.querySelector(".c-abstract");
      if (state.highlight) {
        paintNode(title);
        paintNode(abstract);
      } else {
        clearNode(title);
        clearNode(abstract);
      }
    }
  }

  function paintNode(node) {
    if (!node) return;
    node.innerHTML = highlightHtml(node.textContent ?? "", segments);
  }

  function clearNode(node) {
    if (!node) return;
    node.textContent = node.textContent;
  }
}

/**
 * @param {ParentNode} root
 */
function organicItems(root) {
  return [...root.querySelectorAll("#bsp-results > .c-container, #content_left > .c-container")].filter(isOrganicItem);
}

/**
 * @param {Element} element
 */
function isOrganicItem(element) {
  return element.classList.contains("c-container")
    && element.querySelector(".ec-tuiguang") === null
    && element.querySelector("h3 a[href]") !== null;
}

/**
 * @param {Element} element
 */
function itemHref(element) {
  return element.querySelector("h3 a")?.getAttribute("href") ?? "";
}

/**
 * @param {string} text
 * @param {string[]} segments
 */
function highlightHtml(text, segments) {
  if (segments.length === 0) return escapeHtml(text);
  const pattern = new RegExp(`(${segments.map(escapeRegExp).join("|")})`, "gi");
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(cursor, index));
    html += `<mark class="bsp-hl">${escapeHtml(match[0])}</mark>`;
    cursor = index + match[0].length;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {string} value
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} url
 */
function queryFromUrl(url) {
  const parsed = readUrl(url);
  if (!parsed) return "";
  return parsed.searchParams.get("wd") ?? parsed.searchParams.get("q") ?? "";
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
