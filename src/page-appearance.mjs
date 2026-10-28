import { t } from "./i18n.mjs";
import { CARD_COLUMN_GAP } from "./layout-constants.mjs";

// shortcut: only explicit engine ad containers are handled; extend when verified markup changes.
const AD_SELECTOR = "#tads, #tadsb, #bottomads, #b_results > .b_ad, #b_results > .b_adTop, #b_results > .b_adBottom, #b_adTop, #b_adBottom";
const ATTRIBUTES = ["data-bsp-density", "data-bsp-max-column-width", "data-bsp-google-sidebar", "data-bsp-bing-sidebar", "data-bsp-ai", "data-bsp-ads"];

export function createPageAppearance(document) {
  const root = document.documentElement;
  const savedAttributes = ATTRIBUTES.map(name => [name, root.getAttribute(name)]);
  const savedWidths = ["--bsp-single-max", "--bsp-double-max"].map(name => [name, root.style.getPropertyValue(name),
    typeof root.style.getPropertyPriority === "function" ? root.style.getPropertyPriority(name) : ""]);
  const folds = new Map();
  const regions = new Set();
  return { apply, dispose };

  function restoreWidths() {
    for (const [name, value, priority] of savedWidths) {
      if (value) root.style.setProperty(name, value, priority);
      else root.style.removeProperty(name);
    }
  }

  function unfold(ad, details) {
    const summary = details.querySelector(":scope > summary");
    for (const child of [...details.childNodes]) {
      if (child !== summary) details.parentNode?.insertBefore(child, details);
    }
    details.remove();
    folds.delete(ad);
  }

  function apply(prefs, locale) {
    root.setAttribute("data-bsp-density", prefs.cardDensity);
    root.setAttribute("data-bsp-max-column-width", String(prefs.maxColumnWidth));
    root.setAttribute("data-bsp-google-sidebar", prefs.googleSidebar ? "show" : "hide");
    root.setAttribute("data-bsp-bing-sidebar", prefs.bingSidebar ? "show" : "hide");
    root.setAttribute("data-bsp-ai", prefs.showAI ? "show" : "hide");
    root.setAttribute("data-bsp-ads", prefs.adsMode);
    restoreWidths();
    if (prefs.maxColumnWidth) {
      root.style.setProperty("--bsp-single-max", `${prefs.maxColumnWidth}px`);
      root.style.setProperty("--bsp-double-max", `${prefs.maxColumnWidth * 2 + CARD_COLUMN_GAP}px`);
    }
    for (const [ad, details] of folds) {
      if (prefs.adsMode !== "collapse" || details.parentNode !== ad || !ad.isConnected) unfold(ad, details);
    }
    for (const ad of regions) ad.removeAttribute("data-bsp-ad-region");
    regions.clear();
    if (prefs.adsMode === "original") return;
    for (const ad of document.querySelectorAll(AD_SELECTOR)) {
      // Never wrap result roots or organic cards, even if an engine reuses an ad container ID.
      if (ad.closest("#bsp-results") || ad.querySelector("#rso, #b_results, #bsp-results, .g h3, .tF2Cxc h3, li.b_algo h2")) continue;
      if (ad.parentElement?.closest(AD_SELECTOR)) continue;
      if (!folds.has(ad) && !ad.textContent.trim() && !ad.querySelector("a[href], img, iframe")) continue;
      ad.setAttribute("data-bsp-ad-region", "");
      regions.add(ad);
      if (prefs.adsMode !== "collapse") continue;
      let details = folds.get(ad);
      if (!details) {
        details = document.createElement("details");
        details.className = "bsp-ad-fold";
        const summary = document.createElement("summary");
        details.appendChild(summary);
        folds.set(ad, details);
      }
      for (const child of [...ad.childNodes]) if (child !== details) details.appendChild(child);
      if (details.parentNode !== ad) ad.appendChild(details);
      const summary = details.querySelector(":scope > summary");
      if (summary.textContent !== t(locale, "foldedAds")) summary.textContent = t(locale, "foldedAds");
    }
  }

  function dispose() {
    for (const [ad, details] of folds) unfold(ad, details);
    restoreWidths();
    for (const ad of regions) ad.removeAttribute("data-bsp-ad-region");
    regions.clear();
    for (const [name, value] of savedAttributes) {
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    }
  }
}
