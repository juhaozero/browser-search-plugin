export const DEFAULT_LOCALE = "en";

/** @typedef {"en" | "zh"} Locale */

/** @type {Record<Locale, Record<string, string>>} */
export const MESSAGES = {
  en: {
    tagline: "Cleaner, more readable search layouts",
    layout: "Layout",
    layoutHint: "Applies instantly",
    modeOriginal: "Original",
    modeOriginalDesc: "Keep the engine layout",
    modeSingle: "Single",
    modeSingleDesc: "Stack results vertically",
    modeSingleCenter: "Centered",
    modeSingleCenterDesc: "Comfortable reading width",
    modeDouble: "Dual",
    modeDoubleDesc: "Side-by-side on wide screens",
    reading: "Reading",
    autoPage: "Auto page",
    autoPageDesc: "Load the next page at the bottom",
    langEn: "EN",
    langZh: "中文",
    langLabel: "Language",
    pagesLoaded: "Pages added: {count}",
    pageLoading: "Loading next page…",
    pageFailed: "Could not load results. Try again.",
    pageLimit: "Auto loading paused",
    pageEnd: "No more new results",
    pageRetry: "Retry",
    pageMore: "Load more",
    pageTop: "Back to top",
    appearance: "Appearance",
    cardDensity: "Card density",
    densityCompact: "Compact",
    densityComfortable: "Comfortable",
    densityRelaxed: "Relaxed",
    maxColumnWidth: "Max column width (px)",
    widthHint: "Blank = automatic; 320–1600 per column",
    visibility: "Sidebars, AI & ads",
    googleSidebar: "Google knowledge sidebar",
    bingSidebar: "Bing sidebar",
    showAI: "Google AI Overview",
    adsMode: "Top / bottom ads",
    adsOriginal: "Original",
    adsCollapse: "Collapse",
    adsDim: "Dim",
    adsHint: "Local only. Collapsed ads can be expanded.",
    foldedAds: "Ads — expand to view",
    pagingOptions: "Paging options",
    pagesPerBatch: "Pages per batch",
    nearBottomPx: "Distance from bottom (px)",
    autoContinue: "Continue after each batch",
    autoContinueHint: "Off: pause at the batch limit. On: keep loading while near the bottom.",
  },
  zh: {
    tagline: "把搜索结果排成更易读的版式",
    layout: "布局",
    layoutHint: "立即生效",
    modeOriginal: "原始",
    modeOriginalDesc: "不改引擎排版",
    modeSingle: "单列",
    modeSingleDesc: "卡片纵向堆叠",
    modeSingleCenter: "单列居中",
    modeSingleCenterDesc: "阅读宽度更舒适",
    modeDouble: "双列",
    modeDoubleDesc: "宽屏并排浏览",
    reading: "阅读",
    autoPage: "自动翻页",
    autoPageDesc: "滚到底部时加载下一页结果",
    langEn: "EN",
    langZh: "中文",
    langLabel: "语言",
    pagesLoaded: "已追加 {count} 页",
    pageLoading: "正在加载下一页…",
    pageFailed: "加载失败，请重试",
    pageLimit: "已暂停自动加载",
    pageEnd: "没有更多新结果",
    pageRetry: "重试",
    pageMore: "继续加载",
    pageTop: "返回顶部",
    appearance: "阅读外观",
    cardDensity: "卡片密度",
    densityCompact: "紧凑",
    densityComfortable: "舒适",
    densityRelaxed: "宽松",
    maxColumnWidth: "最大单列宽度（px）",
    widthHint: "留空为自动；每列 320–1600px",
    visibility: "侧栏、AI 与广告",
    googleSidebar: "显示 Google 右栏知识卡",
    bingSidebar: "显示 Bing 右栏",
    showAI: "显示 Google AI 概览",
    adsMode: "顶部／底部广告",
    adsOriginal: "保持原样",
    adsCollapse: "折叠",
    adsDim: "弱化",
    adsHint: "仅本地处理，折叠后仍可展开查看。",
    foldedAds: "广告 — 展开查看",
    pagingOptions: "翻页设置",
    pagesPerBatch: "每批页数",
    nearBottomPx: "距底部距离（px）",
    autoContinue: "每批加载后自动继续",
    autoContinueHint: "关闭时到批次上限暂停；开启后接近底部会继续加载。",
  },
};

/**
 * @param {unknown} raw
 * @returns {Locale}
 */
export function normalizeLocale(raw) {
  return raw === "zh" ? "zh" : DEFAULT_LOCALE;
}

/**
 * @param {Locale} locale
 * @param {string} key
 */
export function t(locale, key) {
  const table = MESSAGES[normalizeLocale(locale)] ?? MESSAGES.en;
  return table[key] ?? MESSAGES.en[key] ?? key;
}

/**
 * @param {Document} document
 * @param {Locale} locale
 */
export function applyLocale(document, locale) {
  const normalized = normalizeLocale(locale);
  const root = document.documentElement;
  root.lang = normalized === "zh" ? "zh-CN" : "en";
  root.dataset.locale = normalized;

  for (const node of document.querySelectorAll("[data-i18n]")) {
    const key = node.getAttribute("data-i18n");
    if (!key) continue;
    node.textContent = t(normalized, key);
  }

  for (const btn of document.querySelectorAll("[data-locale]")) {
    const value = btn.getAttribute("data-locale");
    const active = value === normalized;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.classList.toggle("is-active", active);
  }

  const langGroup = document.querySelector(".bsp-lang");
  if (langGroup) langGroup.setAttribute("aria-label", t(normalized, "langLabel"));
}

/**
 * @param {typeof chrome.storage} [storage]
 */
export function createLocaleStore(storage) {
  if (!storage) {
    let value = DEFAULT_LOCALE;
    const listeners = new Set();
    return {
      async load() {
        return value;
      },
      /**
       * @param {unknown} next
       */
      async save(next) {
        value = normalizeLocale(next);
        for (const listener of listeners) listener(value);
        return value;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  return {
    subscribe(listener) {
      const onChanged = (changes, area) => {
        if ((area === "sync" || area === "local") && changes.uiLocale) {
          listener(normalizeLocale(changes.uiLocale.newValue));
        }
      };
      storage.onChanged.addListener(onChanged);
      return () => {
        try { storage.onChanged.removeListener(onChanged); } catch { /* Context may be invalidated. */ }
      };
    },
    async load() {
      try {
        const sync = await storage.sync.get("uiLocale");
        if (sync?.uiLocale) return normalizeLocale(sync.uiLocale);
      } catch {
        // sync unavailable
      }
      try {
        const local = await storage.local.get("uiLocale");
        if (local?.uiLocale) return normalizeLocale(local.uiLocale);
      } catch {
        // local unavailable
      }
      return DEFAULT_LOCALE;
    },
    /**
     * @param {unknown} next
     */
    async save(next) {
      const uiLocale = normalizeLocale(next);
      try {
        await storage.sync.set({ uiLocale });
        return uiLocale;
      } catch {
        await storage.local.set({ uiLocale });
        return uiLocale;
      }
    },
  };
}
