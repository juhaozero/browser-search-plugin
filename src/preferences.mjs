export const DEFAULT_PREFS = {
  columnMode: "single-center",
  autoPage: true,
  cardDensity: "comfortable",
  maxColumnWidth: 0,
  googleSidebar: true,
  bingSidebar: false,
  showAI: true,
  adsMode: "original",
  pagesPerBatch: 10,
  nearBottomPx: 800,
  autoContinue: false,
};

const COLUMN_MODES = new Set(["original", "single", "single-center", "double"]);

function numberPref(value, fallback, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value) : fallback;
}

/**
 * @param {unknown} raw
 */
export function normalizePrefs(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const columnMode = COLUMN_MODES.has(source.columnMode) ? source.columnMode : DEFAULT_PREFS.columnMode;
  return {
    columnMode,
    autoPage: typeof source.autoPage === "boolean" ? source.autoPage : DEFAULT_PREFS.autoPage,
    cardDensity: ["compact", "comfortable", "relaxed"].includes(source.cardDensity) ? source.cardDensity : DEFAULT_PREFS.cardDensity,
    maxColumnWidth: source.maxColumnWidth === 0 ? 0 : numberPref(source.maxColumnWidth, 0, 320, 1600),
    googleSidebar: typeof source.googleSidebar === "boolean" ? source.googleSidebar : DEFAULT_PREFS.googleSidebar,
    bingSidebar: typeof source.bingSidebar === "boolean" ? source.bingSidebar : DEFAULT_PREFS.bingSidebar,
    showAI: typeof source.showAI === "boolean" ? source.showAI : DEFAULT_PREFS.showAI,
    adsMode: ["original", "collapse", "dim"].includes(source.adsMode) ? source.adsMode : DEFAULT_PREFS.adsMode,
    pagesPerBatch: numberPref(source.pagesPerBatch, DEFAULT_PREFS.pagesPerBatch, 1, 50),
    nearBottomPx: numberPref(source.nearBottomPx, DEFAULT_PREFS.nearBottomPx, 0, 3000),
    autoContinue: typeof source.autoContinue === "boolean" ? source.autoContinue : DEFAULT_PREFS.autoContinue,
  };
}

/**
 * @param {{ prefs?: object }} [initial]
 */
export function createMemoryPrefsStore(initial = {}) {
  let value = normalizePrefs(initial.prefs ?? initial);
  const listeners = new Set();
  return {
    async load() {
      return { ...value };
    },
    async save(next) {
      value = normalizePrefs(next);
      for (const listener of listeners) listener({ ...value });
      return { ...value };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * @param {typeof chrome.storage} storage
 */
export function createChromePrefsStore(storage) {
  return {
    async load() {
      try {
        const sync = await storage.sync.get("prefs");
        if (sync?.prefs) return normalizePrefs(sync.prefs);
      } catch {
        // sync unavailable
      }
      try {
        const local = await storage.local.get("prefs");
        if (local?.prefs) return normalizePrefs(local.prefs);
      } catch {
        // local unavailable
      }
      return { ...DEFAULT_PREFS };
    },
    async save(next) {
      const prefs = normalizePrefs(next);
      try {
        await storage.sync.set({ prefs });
        return prefs;
      } catch {
        await storage.local.set({ prefs });
        return prefs;
      }
    },
    subscribe(listener) {
      const onChanged = (changes, area) => {
        if (area !== "sync" && area !== "local") return;
        if (!changes.prefs) return;
        listener(normalizePrefs(changes.prefs.newValue ?? DEFAULT_PREFS));
      };
      storage.onChanged.addListener(onChanged);
      return () => {
        try {
          storage.onChanged.removeListener(onChanged);
        } catch {
          // 扩展上下文失效时 removeListener 可能抛错
        }
      };
    },
  };
}
