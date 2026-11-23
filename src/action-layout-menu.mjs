import { createLocaleStore, t } from "./i18n.mjs";
import { createChromePrefsStore, DEFAULT_PREFS, normalizePrefs } from "./preferences.mjs";

/** Popup order: original → single → single-center → double */
export const COLUMN_MENU_MODES = ["original", "single", "single-center", "double"];

export const GITHUB_REPO_URL = "https://github.com/juhaozero/browser-search-plugin/";
export const GITHUB_MENU_ID = "bsp-open-github";
const SEPARATOR_MENU_ID = "bsp-layout-separator";

const MODE_LABEL = {
  original: "modeOriginal",
  single: "modeSingle",
  "single-center": "modeSingleCenter",
  double: "modeDouble",
};

const MENU_PREFIX = "bsp-column-";

/**
 * @param {string} mode
 */
export function menuIdForColumnMode(mode) {
  return `${MENU_PREFIX}${mode}`;
}

/**
 * @param {unknown} menuItemId
 * @returns {string | null}
 */
export function columnModeFromMenuId(menuItemId) {
  if (typeof menuItemId !== "string" || !menuItemId.startsWith(MENU_PREFIX)) return null;
  const mode = menuItemId.slice(MENU_PREFIX.length);
  return COLUMN_MENU_MODES.includes(mode) ? mode : null;
}

/**
 * @param {string} locale
 * @param {string} columnMode
 */
export function actionTitleFor(locale, columnMode) {
  const mode = COLUMN_MENU_MODES.includes(columnMode) ? columnMode : DEFAULT_PREFS.columnMode;
  const label = t(locale, MODE_LABEL[mode]);
  return t(locale, "actionTitle").replace("{mode}", label);
}

/**
 * @param {typeof chrome} api
 * @param {{ load: () => Promise<object> }} prefsStore
 * @param {{ load: () => Promise<string> }} localeStore
 */
export async function refreshActionLayoutMenu(api, prefsStore, localeStore) {
  const [prefs, locale] = await Promise.all([prefsStore.load(), localeStore.load()]);
  const normalized = normalizePrefs(prefs);
  const mode = normalized.columnMode;
  await removeAllMenus(api.contextMenus);
  for (const next of COLUMN_MENU_MODES) {
    api.contextMenus.create({
      id: menuIdForColumnMode(next),
      title: t(locale, MODE_LABEL[next]),
      type: "radio",
      checked: next === mode,
      contexts: ["action"],
    });
  }
  api.contextMenus.create({
    id: SEPARATOR_MENU_ID,
    type: "separator",
    contexts: ["action"],
  });
  api.contextMenus.create({
    id: GITHUB_MENU_ID,
    title: t(locale, "openGitHub"),
    contexts: ["action"],
  });
  await api.action.setTitle({ title: actionTitleFor(locale, mode) });
  return { mode, locale, title: actionTitleFor(locale, mode) };
}

/**
 * @param {typeof chrome} api
 */
export async function openGitHubFromMenu(api) {
  try {
    await api.tabs.create({ url: GITHUB_REPO_URL });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {typeof chrome} api
 * @param {{ load: () => Promise<object>, save: (prefs: object) => Promise<object> }} prefsStore
 * @param {{ menuItemId?: string }} info
 */
export async function applyColumnModeFromMenu(_api, prefsStore, info) {
  const mode = columnModeFromMenuId(info?.menuItemId);
  if (!mode) return null;
  const prefs = normalizePrefs(await prefsStore.load());
  if (prefs.columnMode === mode) return null;
  return prefsStore.save({ ...prefs, columnMode: mode });
}

/**
 * @param {typeof chrome} api
 */
export function registerActionLayoutMenu(api) {
  if (!api?.contextMenus || !api?.action) return;
  const prefsStore = createChromePrefsStore(api.storage);
  const localeStore = createLocaleStore(api.storage);
  let queue = Promise.resolve();
  const sync = () => {
    queue = queue
      .catch(() => {})
      .then(() => refreshActionLayoutMenu(api, prefsStore, localeStore))
      .catch(() => {});
    return queue;
  };

  api.runtime.onInstalled.addListener(() => {
    void sync();
  });
  prefsStore.subscribe?.(() => {
    void sync();
  });
  localeStore.subscribe?.(() => {
    void sync();
  });
  api.contextMenus.onClicked.addListener((info) => {
    if (info?.menuItemId === GITHUB_MENU_ID) {
      void openGitHubFromMenu(api);
      return;
    }
    void applyColumnModeFromMenu(api, prefsStore, info).then((saved) => {
      // Same-mode clicks still refresh title/checkmarks if the worker just woke.
      if (!saved) void sync();
    });
  });
  void sync();
}

/**
 * @param {typeof chrome.contextMenus} contextMenus
 */
function removeAllMenus(contextMenus) {
  return new Promise((resolve) => {
    try {
      const result = contextMenus.removeAll(() => resolve());
      if (result && typeof result.then === "function") {
        void result.then(resolve, () => resolve());
      }
    } catch {
      resolve();
    }
  });
}
