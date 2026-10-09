import { applyLocale, createLocaleStore, DEFAULT_LOCALE, normalizeLocale } from "./i18n.mjs";
import { DEFAULT_PREFS, createChromePrefsStore, normalizePrefs } from "./preferences.mjs";

/**
 * @param {Document} document
 * @param {{
 *   prefsStore?: { load: () => Promise<object>, save: (prefs: object) => Promise<object> },
 *   localeStore?: { load: () => Promise<string>, save: (locale: string) => Promise<string> },
 * }} [deps]
 */
export async function mountPopup(document, deps = {}) {
  const store = deps.prefsStore
    ?? (typeof chrome !== "undefined" && chrome?.storage
      ? createChromePrefsStore(chrome.storage)
      : null);
  if (!store) throw new Error("没有可用的偏好存储");

  const localeStore = deps.localeStore
    ?? (typeof chrome !== "undefined" && chrome?.storage
      ? createLocaleStore(chrome.storage)
      : createLocaleStore());

  const [prefs, locale] = await Promise.all([store.load(), localeStore.load()]);
  paint(document, prefs);
  applyLocale(document, normalizeLocale(locale));

  const form = document.getElementById("bsp-prefs");
  if (!form) throw new Error("弹窗缺少表单");

  async function commit() {
    const next = readForm(document);
    const saved = await store.save(next);
    paint(document, saved);
    return saved;
  }

  form.addEventListener("change", () => {
    void commit();
  });

  for (const btn of document.querySelectorAll("[data-locale]")) {
    btn.addEventListener("click", () => {
      const next = normalizeLocale(btn.getAttribute("data-locale"));
      applyLocale(document, next);
      void localeStore.save(next);
    });
  }

  return {
    commit,
    async getPrefs() {
      return store.load();
    },
    async getLocale() {
      return localeStore.load();
    },
    /**
     * @param {string} next
     */
    async setLocale(next) {
      const saved = await localeStore.save(next);
      applyLocale(document, saved);
      return saved;
    },
  };
}

/**
 * @param {Document} document
 * @param {{ columnMode: string, autoPage: boolean }} prefs
 */
export function paint(document, prefs) {
  const normalized = normalizePrefs(prefs);
  for (const input of document.querySelectorAll("input[name='columnMode']")) {
    input.checked = input.value === normalized.columnMode;
  }
  const autoPage = document.querySelector("input[name='autoPage']");
  if (autoPage) autoPage.checked = normalized.autoPage;
}

/**
 * @param {Document} document
 */
export function readForm(document) {
  const column = [...document.querySelectorAll("input[name='columnMode']")].find((input) => input.checked);
  const autoPage = document.querySelector("input[name='autoPage']");
  return normalizePrefs({
    columnMode: column?.value ?? DEFAULT_PREFS.columnMode,
    autoPage: Boolean(autoPage?.checked),
  });
}

if (typeof document !== "undefined" && document.getElementById("bsp-prefs")) {
  void mountPopup(document);
}

export { DEFAULT_LOCALE, applyLocale };
