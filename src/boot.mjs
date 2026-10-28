import { createSearchSession, isDesktopWebSearch } from "./search-session.mjs";
import { createAutoPager, fetchHtmlDocument } from "./auto-page.mjs";
import { DEFAULT_PREFS, createChromePrefsStore, normalizePrefs } from "./preferences.mjs";
import { createLocaleStore } from "./i18n.mjs";
import { isExtensionContextValid } from "./content-lifecycle.mjs";
import { endLayoutGate } from "./layout-gate.mjs";
import { DOM_MUTE_FLAG, RELAYOUT_FLAG } from "./layout-constants.mjs";
import { clearCenteredLayout, realign } from "./shell-layout.mjs";
import { attachScroll, watchResults } from "./dom-watch.mjs";

/**
 * @param {Document} document
 * @param {string} url
 * @param {{ viewportWidth?: number, parentLeft?: number }} [layout]
 * @param {{
 *   prefs?: { columnMode?: string, autoPage?: boolean },
 *   prefsStore?: { load: () => Promise<object>, save?: Function, subscribe?: Function },
 *   localeStore?: { load: () => Promise<string>, subscribe?: Function },
 *   fetchDocument?: (url: string) => Promise<Document>,
 *   attachScroll?: boolean,
 *   watchDom?: boolean,
 * }} [deps]
 */
async function bootSearchPage(document, url, layout = {}, deps = {}) {
  if (!isDesktopWebSearch(url)) return null;
  const store = deps.prefsStore
    ?? (typeof chrome !== "undefined" && chrome?.storage
      ? createChromePrefsStore(chrome.storage)
      : null);
  const localeStore = deps.localeStore ?? createLocaleStore(typeof chrome !== "undefined" ? chrome.storage : undefined);
  const [rawPrefs, locale] = await Promise.all([
    deps.prefs ?? (store ? store.load() : DEFAULT_PREFS), localeStore.load(),
  ]);
  const prefs = normalizePrefs(rawPrefs);
  const session = createSearchSession(document, url, prefs);
  realign(document, layout);
  markActive(document, session.engine);
  // 布局已落到自定义列模式（或 original），允许显示结果区
  endLayoutGate(document);

  let watcher = {
    dispose() {},
    runMuted(fn) {
      return fn();
    },
  };

  const pager = createAutoPager({
    document,
    session,
    url,
    enabled: prefs.autoPage,
    locale,
    fetchDocument: deps.fetchDocument ?? fetchHtmlDocument,
    mutate: (fn) => watcher.runMuted(fn),
  });
  const stopScroll = deps.attachScroll !== false ? attachScroll(document, pager) : () => {};

  if (deps.watchDom !== false) {
    watcher = watchResults(document, () => {
      // 失效时只跳过本轮；由 content 侧 interval guard 负责 teardown，避免误判瞬时拆掉 UI
      if (!isExtensionContextValid()) return;
      if (disposed) return;
      watcher.runMuted(() => {
        session.refresh();
        realign(document, layout);
        markActive(document, session.engine);
      });
      // check/ingest 在 mute 外发起请求，真正改 DOM 时走 pager.mutate → runMuted
      void pager.check();
    });
  }

  const applyPrefs = (next) => {
    if (disposed) return;
    const normalized = normalizePrefs(next);
    watcher.runMuted(() => {
      session.apply(normalized);
      pager.setEnabled(normalized.autoPage);
      realign(document, layout);
      markActive(document, session.engine);
    });
  };

  let disposed = false;
  let resizeTimer = 0;
  let unsubscribe = () => {};
  if (store?.subscribe) unsubscribe = store.subscribe(applyPrefs);
  const unsubscribeLocale = localeStore.subscribe?.((next) => pager.setLocale(next)) ?? (() => {});
  const onResize = () => {
    if (disposed) return;
    if (resizeTimer) (globalThis.clearTimeout ?? clearTimeout)(resizeTimer);
    resizeTimer = (globalThis.setTimeout ?? setTimeout)(() => {
      resizeTimer = 0;
      if (disposed) return;
      realign(document, {});
    }, 120);
  };
  const view = document.defaultView;
  if (view && typeof view.addEventListener === "function") {
    view.addEventListener("resize", onResize, { passive: true });
  }

  /**
   * teardown 必须尽量跑完：扩展 reload 后 chrome.storage.removeListener 可能抛错，
   * 不能因此跳过 MutationObserver.disconnect。
   */
  function disposeBoot() {
    if (disposed) return;
    disposed = true;
    const silent = (fn) => {
      try {
        fn();
      } catch {
        // 上下文失效时 chrome.* 常抛错，忽略并继续拆本地资源
      }
    };
    silent(() => unsubscribe());
    silent(() => unsubscribeLocale());
    silent(() => {
      watcher.runMuted(() => {
        session.dispose?.();
      });
    });
    silent(() => watcher.dispose());
    silent(() => stopScroll());
    silent(() => pager.dispose?.());
    silent(() => clearCenteredLayout(document));
    silent(() => {
      delete document.documentElement.dataset[RELAYOUT_FLAG];
      delete document.documentElement.dataset[DOM_MUTE_FLAG];
      delete document.documentElement.dataset.bspShellWidth;
      delete document.documentElement.dataset.bspActive;
      delete document.documentElement.dataset.bspEngine;
      delete document.documentElement.dataset.bspColumnMode;
      // 拆掉布局时重新关门控；下一次 start/boot 会再打开
      delete document.documentElement.dataset.bspReady;
    });
    silent(() => {
      if (resizeTimer) (globalThis.clearTimeout ?? clearTimeout)(resizeTimer);
    });
    silent(() => view?.removeEventListener?.("resize", onResize));
  }

  return {
    session,
    pager,
    applyPrefs,
    dispose: disposeBoot,
  };
}

/**
 * @param {Document} document
 * @param {string} engine
 */
function markActive(document, engine) {
  document.documentElement.dataset.bspActive = "1";
  document.documentElement.dataset.bspEngine = engine;
  const box = document.getElementById("bsp-results");
  if (box) {
    box.dataset.bspCount = String(box.children.length);
    if (box.dataset.mode) document.documentElement.dataset.bspColumnMode = box.dataset.mode;
    else delete document.documentElement.dataset.bspColumnMode;
  } else {
    delete document.documentElement.dataset.bspActive;
    delete document.documentElement.dataset.bspColumnMode;
  }
}

export { bootSearchPage };
