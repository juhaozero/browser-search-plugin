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
  form.addEventListener("submit", event => event.preventDefault());

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
 * @param {Partial<typeof DEFAULT_PREFS>} prefs
 */
export function paint(document, prefs) {
  const normalized = normalizePrefs(prefs);
  for (const input of document.querySelectorAll("input[name='columnMode']")) {
    input.checked = input.value === normalized.columnMode;
  }
  for (const [name, value] of Object.entries(normalized)) {
    if (name === "columnMode") continue;
    const input = document.querySelector(`[name='${name}']`);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = value;
    else if (input.tagName === "SELECT") {
      for (const option of input.querySelectorAll("option")) if (option.value === value) option.selected = true;
    }
    else input.value = name === "maxColumnWidth" && value === 0 ? "" : String(value);
  }
}

/**
 * @param {Document} document
 */
export function readForm(document) {
  const column = [...document.querySelectorAll("input[name='columnMode']")].find((input) => input.checked);
  const next = { ...DEFAULT_PREFS, columnMode: column?.value ?? DEFAULT_PREFS.columnMode };
  for (const [name, fallback] of Object.entries(DEFAULT_PREFS)) {
    if (name === "columnMode") continue;
    const input = document.querySelector(`[name='${name}']`);
    if (!input) continue;
    next[name] = typeof fallback === "boolean" ? Boolean(input.checked)
      : typeof fallback === "number" ? Number(input.value) : input.value;
  }
  return normalizePrefs(next);
}

if (typeof document !== "undefined" && document.getElementById("bsp-prefs")) {
  void mountPopup(document);
}

export { DEFAULT_LOCALE, applyLocale };
