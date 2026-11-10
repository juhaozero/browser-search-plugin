export const DEFAULT_LOCALE = "en";

/** @typedef {"en" | "zh"} Locale */

/** @type {Record<Locale, Record<string, string>>} */
export const MESSAGES = {
  en: {
    presets: "Quick presets",
    presetSimple: "Simple",
    presetReading: "Focused reading",
    presetMinimal: "Minimal distractions",
    presetCustom: "Custom",
    presetHint: "Adjust how search results look and which sections are visible.",
    advanced: "Advanced",
    cleanResults: "Clean up results",
    collapsePaa: "Collapse People Also Ask",
    collapseVideos: "Collapse video carousels",
    collapseSnippets: "Collapse featured snippets",
    blocksHint: "Each block can still be expanded on the page.",
    domainUnavailable: "Open a Google, Bing, DuckDuckGo, or Baidu web search results page, refresh it, then reopen this popup.",
    domainTitle: "Hide domains on this page",
    domainLabel: "Domains (including subdomains)",
    domainHelp: "Separate domains with spaces or commas, e.g. pinterest.com, zhihu.com. Page only; clears on reload. No uploads or saved filtering data.",
    domainApply: "Apply",
    domainClear: "Restore all",
    domainInvalid: "Enter valid domains, without paths or wildcards.",
    domainCount: "Hidden results: {count}",
    foldedPaa: "People Also Ask — expand to view",
    foldedVideos: "Videos — expand to view",
    foldedSnippets: "Featured snippet — expand to view",
    browsing: "Results & navigation",
    resultOpenMode: "Open result titles",
    openOriginal: "Engine default",
    openCurrent: "Current tab",
    openNew: "New tab",
    openBackground: "Background tab",
    openHint: "New / background tabs keep your results page. Modifier clicks keep browser behavior.",
    pinRelated: "Pin related searches at the bottom",
    emphasizeSite: "Emphasize site icon & domain",
    dimVisited: "Mute visited link colors",
    visitedHint: "No history access. New / background tabs are also marked as opened on this page until reload.",
    relatedSearches: "Related searches",
    openFailed: "Could not open tab. Click the title to retry, or use the browser’s link menu.",
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
    presets: "一键预设",
    presetSimple: "简洁",
    presetReading: "专注阅读",
    presetMinimal: "极简干扰",
    presetCustom: "自定义",
    presetHint: "调整结果页外观和各类内容的显示方式。",
    advanced: "高级",
    cleanResults: "精简结果页",
    collapsePaa: "折叠「大家还在问」",
    collapseVideos: "折叠视频轮播",
    collapseSnippets: "折叠精选摘要",
    blocksHint: "各类内容独立控制，折叠后仍可在页面展开。",
    domainUnavailable: "请打开 Google、Bing、DuckDuckGo 或百度的网页搜索结果页，刷新页面后重新打开弹窗。",
    domainTitle: "本页隐藏域名",
    domainLabel: "域名（包含子域名）",
    domainHelp: "空格或逗号分隔，如 pinterest.com、zhihu.com。仅本页有效，刷新后清除，不保存或上传过滤记录。",
    domainApply: "应用",
    domainClear: "恢复全部",
    domainInvalid: "请输入有效域名，不含路径或通配符。",
    domainCount: "已隐藏 {count} 条结果",
    foldedPaa: "大家还在问 — 展开查看",
    foldedVideos: "视频轮播 — 展开查看",
    foldedSnippets: "精选摘要 — 展开查看",
    browsing: "结果与导航",
    resultOpenMode: "结果标题打开方式",
    openOriginal: "保持引擎默认",
    openCurrent: "当前标签",
    openNew: "新标签",
    openBackground: "后台标签",
    openHint: "新标签／后台标签会保留结果页；组合键点击仍遵循浏览器行为。",
    pinRelated: "底部固定相关搜索",
    emphasizeSite: "强化站点图标与域名",
    dimVisited: "弱化已访问链接颜色",
    visitedHint: "不读取浏览历史；新标签／后台标签成功打开后在当前页标记，刷新后清除。",
    relatedSearches: "相关搜索",
    openFailed: "打开标签失败，请再次点击标题，或使用浏览器的链接菜单。",
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
