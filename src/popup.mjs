import { applyLocale, createLocaleStore, DEFAULT_LOCALE, normalizeLocale, t } from "./i18n.mjs";
import { DEFAULT_PREFS, PREF_PRESETS, applyPreset, createChromePrefsStore, normalizePrefs } from "./preferences.mjs";
import { createPageDomainsClient, mountPopupDomains } from "./popup-domains.mjs";
import { finishOnboarding, hasPendingOnboarding } from "./onboarding.mjs";

/**
 * @param {Document} document
 * @param {{
 *   prefsStore?: { load: () => Promise<object>, save: (prefs: object) => Promise<object> },
 *   localeStore?: { load: () => Promise<string>, save: (locale: string) => Promise<string> },
 * }} [deps]
 */
export async function mountPopup(document, deps = {}) {
  const api = typeof chrome === "undefined" ? null : chrome;
  const store = deps.prefsStore ?? (api?.storage ? createChromePrefsStore(api.storage) : null);
  if (!store) throw new Error("没有可用的偏好存储");

  const guide = document.getElementById("bsp-onboarding");
  const showGuide = Boolean(guide && api?.runtime && await hasPendingOnboarding(api.storage?.local));
  const localeStore = deps.localeStore
    ?? createLocaleStore(api?.storage, showGuide ? "zh" : DEFAULT_LOCALE);

  const [prefs, locale] = await Promise.all([store.load(), localeStore.load()]);
  paint(document, prefs);
  applyLocale(document, normalizeLocale(locale));
  const form = document.getElementById("bsp-prefs");
  if (!form) throw new Error("弹窗缺少表单");
  const saveError = document.getElementById("bsp-prefs-save-error");
  let domains;
  let pendingSave = Promise.resolve();
  let saveGeneration = 0;

  async function showSettings() {
    if (guide) guide.hidden = true;
    form.hidden = false;
    domains = await mountPopupDomains(document, deps.pageDomainsClient
      ?? (api?.tabs ? createPageDomainsClient(api.tabs) : async () => null));
  }

  async function commit() {
    const next = readForm(document);
    const generation = ++saveGeneration;
    const save = pendingSave.then(() => store.save(next));
    pendingSave = save.catch(() => {});
    try {
      const saved = await save;
      if (generation === saveGeneration) {
        if (saveError) saveError.hidden = true;
        paint(document, saved);
      }
      return saved;
    } catch (error) {
      if (saveError && generation === saveGeneration) saveError.hidden = false;
      throw error;
    }
  }

  const saveFromForm = () => { void commit().catch(() => {}); };

  form.addEventListener("change", event => {
    if (event.target.closest("#bsp-domain-controls")) return;
    saveFromForm();
  });
  form.addEventListener("submit", event => event.preventDefault());

  for (const button of document.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () => {
      paint(document, applyPreset(readForm(document), button.dataset.preset));
      saveFromForm();
    });
  }

  for (const btn of document.querySelectorAll("[data-locale]")) {
    btn.addEventListener("click", () => {
      const next = normalizeLocale(btn.getAttribute("data-locale"));
      applyLocale(document, next);
      domains?.render();
      void localeStore.save(next);
    });
  }

  if (showGuide) {
    guide.hidden = false;
    const button = document.getElementById("bsp-onboarding-try");
    const skip = document.getElementById("bsp-onboarding-skip");
    const errorMessage = document.getElementById("bsp-onboarding-error");
    const labelButton = key => {
      button.dataset.i18n = key;
      button.textContent = t(document.documentElement.dataset.locale, key);
    };
    async function finishGuide(action, trigger) {
      if (button.disabled) return;
      button.disabled = true;
      skip.disabled = true;
      errorMessage.hidden = true;
      if (action === "preview") labelButton("onboardingStarting");
      const result = await finishOnboarding(api, action);
      if (result === "ok") {
        paint(document, await store.load());
        const settings = showSettings();
        form.querySelector("input[name='columnMode']:checked")?.focus();
        await settings;
      } else {
        button.disabled = false;
        skip.disabled = false;
        labelButton("onboardingTry");
        const errorKey = result === "preview" ? "onboardingPreviewFailed"
          : result === "storage" ? "onboardingStorageFailed" : "onboardingFailed";
        errorMessage.dataset.i18n = errorKey;
        errorMessage.textContent = t(document.documentElement.dataset.locale, errorKey);
        errorMessage.hidden = false;
        trigger.focus();
      }
    }
    button.addEventListener("click", () => { void finishGuide("preview", button); });
    skip.addEventListener("click", () => { void finishGuide("skip", skip); });
  } else {
    await showSettings();
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
      domains?.render();
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
  const matchingPreset = Object.keys(PREF_PRESETS).find(name =>
    Object.entries(PREF_PRESETS[name]).every(([key, value]) => normalized[key] === value),
  );
  for (const button of document.querySelectorAll("[data-preset]")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === matchingPreset));
  }
  document.getElementById("bsp-preset-custom")?.toggleAttribute("hidden", Boolean(matchingPreset));
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
