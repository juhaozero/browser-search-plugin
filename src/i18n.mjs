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
    return {
      async load() {
        return value;
      },
      /**
       * @param {unknown} next
       */
      async save(next) {
        value = normalizeLocale(next);
        return value;
      },
    };
  }

  return {
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
