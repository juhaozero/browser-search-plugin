import { bingTargetUrl, titleLink } from "./search-session.mjs";
import { safeWebUrl } from "./result-tabs.mjs";
import { t } from "./i18n.mjs";
import { BING_HOSTS } from "./search-hosts.mjs";

export { titleLink };

export function destinationUrl(href, base, engine) {
  let url = safeWebUrl(href, base);
  if (!url) return null;
  const parsed = new URL(url);
  if (engine === "bing" && BING_HOSTS.includes(parsed.hostname)) url = bingTargetUrl(url);
  if (engine === "google" && parsed.origin === new URL(base).origin && parsed.pathname === "/url") {
    url = parsed.searchParams.get("q") ?? parsed.searchParams.get("url") ?? url;
  }
  return safeWebUrl(url, base);
}

export function relatedLinks(document, base, engine) {
  const current = new URL(base);
  const links = new Map();
  // shortcut: explicit related-search containers only, extend after verifying new engine markup.
  const selector = engine === "bing" ? ".b_rs a[href]" : "#bres a[href], #botstuff a[href], [data-related-searches] a[href]";
  for (const link of document.querySelectorAll(selector)) {
    const href = safeWebUrl(link.getAttribute("href"), base);
    if (!href) continue;
    const url = new URL(href);
    const query = url.searchParams.get("q")?.trim();
    const label = link.textContent.replace(/\s+/g, " ").trim();
    if (url.origin !== current.origin || url.pathname !== "/search" || !query || !label
      || query === current.searchParams.get("q") || url.searchParams.has("start") || url.searchParams.has("first")) continue;
    if (!links.has(query)) links.set(query, { href, label });
    if (links.size === 12) break;
  }
  return [...links.values()];
}

export function createResultTools(document, url, session, sendMessage = message => chrome.runtime.sendMessage(message)) {
  let prefs;
  let locale;
  let disposed = false;
  let bar = null;
  let spacer = null;
  let barSignature = "";
  const marked = new Map();
  const badges = new Map();
  const errors = new Set();
  // shortcut: opened destinations live only in this page session, add persistence only if explicitly requested.
  const opened = new Set();
  const openedLinks = new Map();
  const root = document.documentElement;
  const oldVisited = root.getAttribute("data-bsp-dim-visited");
  document.addEventListener("click", onClick, true);
  return { refresh, dispose };

  function refresh(next = prefs, nextLocale = locale) {
    if (disposed) return;
    prefs = next;
    locale = nextLocale;
    root.setAttribute("data-bsp-dim-visited", String(prefs.dimVisited));
    const items = new Set(session.items);
    for (const [item, badge] of badges) {
      if (!prefs.emphasizeSite || !items.has(item)) { badge.remove(); badges.delete(item); }
    }
    for (const [item, previous] of marked) {
      if (!items.has(item)) { restoreMark(item, previous); marked.delete(item); }
    }
    for (const item of items) {
      if (!marked.has(item)) marked.set(item, item.getAttribute("data-bsp-result"));
      item.setAttribute("data-bsp-result", "");
      if (!prefs.emphasizeSite) continue;
      const link = titleLink(item);
      const destination = link && destinationUrl(link.getAttribute("href"), url, session.engine);
      const host = destination ? new URL(destination).hostname : "";
      const existing = badges.get(item);
      if (existing?.dataset.host === host && existing.parentNode === item) continue;
      existing?.remove();
      badges.delete(item);
      if (!host) continue;
      const badge = document.createElement("div");
      badge.className = "bsp-site-badge";
      badge.dataset.host = host;
      const icon = document.createElement("span");
      icon.className = "bsp-site-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = host.replace(/^www\./, "").slice(0, 1).toUpperCase();
      // Reuse only an existing site icon; never request a third-party favicon service.
      const nativeIcon = item.querySelector('img[src][width="16"], img[src][width="20"], img[src][width="24"], .b_favicon img, img.XNo5Ab');
      if (nativeIcon) {
        const image = document.createElement("img");
        const src = nativeIcon.getAttribute("src");
        if (/^(https?:|data:image\/)/i.test(src)) {
          image.src = src; image.alt = ""; image.referrerPolicy = "no-referrer";
          image.addEventListener("error", () => image.remove(), { once: true });
          icon.appendChild(image);
        }
      }
      const label = document.createElement("span");
      label.className = "bsp-site-domain";
      label.textContent = host;
      badge.append(icon, label);
      item.prepend(badge);
      badges.set(item, badge);
    }
    refreshOpened();
    const links = prefs.pinRelated ? relatedLinks(document, url, session.engine) : [];
    const signature = JSON.stringify([locale, links]);
    if (links.length && (signature !== barSignature || !bar?.isConnected || !spacer?.isConnected)) {
      removeBar();
      bar = document.createElement("nav");
      bar.id = "bsp-related";
      bar.setAttribute("aria-label", t(locale, "relatedSearches"));
      const heading = document.createElement("strong");
      heading.textContent = t(locale, "relatedSearches");
      bar.appendChild(heading);
      for (const { href, label } of links) {
        const link = document.createElement("a");
        link.href = href; link.textContent = label;
        bar.appendChild(link);
      }
      spacer = document.createElement("div");
      spacer.id = "bsp-related-space";
      spacer.setAttribute("aria-hidden", "true");
      document.body.append(spacer, bar);
      barSignature = signature;
    } else if (!links.length) removeBar();
  }

  function onClick(event) {
    if (!prefs || prefs.resultOpenMode === "original" || event.defaultPrevented || event.button !== 0
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.("a[href]");
    if (!link || link.hasAttribute("download")) return;
    const item = session.items.find(item => titleLink(item) === link);
    if (!item) return;
    const href = safeWebUrl(link.getAttribute("href"), url);
    if (!href) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    for (const error of errors) { error.remove(); errors.delete(error); }
    if (prefs.resultOpenMode === "current") { document.defaultView.location.assign(href); return; }
    const mode = prefs.resultOpenMode;
    const trackOpened = prefs.dimVisited;
    const destination = destinationUrl(href, url, session.engine);
    void Promise.resolve().then(() => sendMessage({ type: "bsp-open-result", url: href, mode }))
      .then(response => {
        if (!response?.ok) throw new Error("open failed");
        if (disposed || !trackOpened || !prefs.dimVisited || !destination) return;
        opened.add(destination);
        refreshOpened();
      })
      .catch(() => {
        if (disposed || !item.isConnected) return;
        for (const error of errors) { error.remove(); errors.delete(error); }
        const error = document.createElement("span");
        error.className = "bsp-open-error"; error.setAttribute("role", "alert");
        error.textContent = t(locale, "openFailed");
        item.appendChild(error); errors.add(error);
      });
  }

  function refreshOpened() {
    for (const [link, previous] of openedLinks) {
      if (!link.isConnected || !opened.has(destinationUrl(link.getAttribute("href"), url, session.engine))) {
        restoreOpened(link, previous);
        openedLinks.delete(link);
      }
    }
    if (!opened.size) return;
    for (const item of session.items) {
      const link = titleLink(item);
      if (!link || !opened.has(destinationUrl(link.getAttribute("href"), url, session.engine))) continue;
      if (!openedLinks.has(link)) openedLinks.set(link, link.getAttribute("data-bsp-opened"));
      link.setAttribute("data-bsp-opened", "true");
    }
  }

  function restoreOpened(link, value) {
    if (value === null) link.removeAttribute("data-bsp-opened");
    else link.setAttribute("data-bsp-opened", value);
  }

  function removeBar() { bar?.remove(); spacer?.remove(); bar = null; spacer = null; barSignature = ""; }
  function restoreMark(item, value) {
    if (value === null) item.removeAttribute("data-bsp-result");
    else item.setAttribute("data-bsp-result", value);
  }
  function dispose() {
    disposed = true;
    document.removeEventListener("click", onClick, true);
    for (const badge of badges.values()) badge.remove();
    for (const [item, value] of marked) restoreMark(item, value);
    for (const error of errors) error.remove();
    for (const [link, value] of openedLinks) restoreOpened(link, value);
    opened.clear(); openedLinks.clear();
    badges.clear(); marked.clear(); errors.clear(); removeBar();
    if (oldVisited === null) root.removeAttribute("data-bsp-dim-visited");
    else root.setAttribute("data-bsp-dim-visited", oldVisited);
  }
}
