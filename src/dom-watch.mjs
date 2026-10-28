import { isOwnDomElement } from "./layout-dom.mjs";
import { DOM_MUTE_FLAG, RELAYOUT_FLAG } from "./layout-constants.mjs";
import { findLayoutShell } from "./layout-dom.mjs";

const RESULTS_WATCH_IDS = ["rso", "search", "center_col", "b_results", "b_content"];

/** 顶栏/导航晚到时也要触发 realign（结果区 observer 看不到） */
const NAV_WATCH_IDS = ["searchform", "sfcnt", "sf", "appbar", "slim_appbar", "hdtb", "b_header"];

/**
 * @param {Document} document
 * @param {{ check: () => Promise<unknown> }} pager
 */
function attachScroll(document, pager) {
  const view = document.defaultView;
  if (!view || typeof view.addEventListener !== "function") return () => {};
  let queued = false;
  let stopped = false;
  const onScroll = () => {
    if (stopped || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (stopped) return;
      void pager.check();
    });
  };
  view.addEventListener("scroll", onScroll, { passive: true });
  void pager.check();
  return () => {
    stopped = true;
    view.removeEventListener("scroll", onScroll);
  };
}

/**
 * 结果区观察根：只盯搜索引擎结果容器，绝不退化为整页 documentElement。
 * @param {Document} document
 * @returns {Element | null}
 */
function resolveResultsWatchRoot(document) {
  for (const id of RESULTS_WATCH_IDS) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

/**
 * @param {Document} document
 * @param {() => void} onChange
 * @returns {{ dispose: () => void, runMuted: <T>(fn: () => T) => T }}
 */
function watchResults(document, onChange) {
  const noop = {
    dispose() {},
    runMuted(fn) {
      return fn();
    },
  };
  if (typeof MutationObserver !== "function") return noop;

  let timer = 0;
  let muteDepth = 0;
  /** @type {ReturnType<typeof setInterval> | number | null} */
  let findTimer = null;
  let findAttempts = 0;

  const clearTimer = () => {
    if (!timer) return;
    (globalThis.clearTimeout ?? clearTimeout)(timer);
    timer = 0;
  };

  const clearFindTimer = () => {
    if (findTimer == null) return;
    (globalThis.clearInterval ?? clearInterval)(findTimer);
    findTimer = null;
  };

  const onMutations = (records) => {
    if (muteDepth > 0) return;
    if (document.documentElement.dataset[RELAYOUT_FLAG]) return;
    if (document.documentElement.dataset[DOM_MUTE_FLAG]) return;
    if (records.every(isOwnDomMutation)) return;
    if (timer) return;
    timer = (globalThis.setTimeout ?? setTimeout)(() => {
      timer = 0;
      onChange();
    }, 120);
  };

  /** @type {MutationObserver[]} */
  const observers = [];
  const observedScopes = new Set();

  const attach = (root) => {
    if ([...observedScopes].some(scope => scope.contains(root))) return;
    const obs = new MutationObserver(onMutations);
    obs.observe(root, { childList: true, subtree: true });
    observers.push(obs);
    observedScopes.add(root);
  };

  const attachNavWatches = (except) => {
    for (const id of NAV_WATCH_IDS) {
      const el = document.getElementById(id);
      if (!el || el === except || except?.contains(el)) continue;
      attach(el);
    }
  };

  const root = resolveResultsWatchRoot(document);
  if (root) {
    // 顶部 AI 常是 #center_col 的兄弟；只观察 #rso 会漏掉它的插入。
    const shell = findLayoutShell(document);
    const scope = shell?.contains(root) ? shell : root;
    attach(scope);
    attachNavWatches(scope);
  } else {
    // 结果容器晚到时用有界轮询挂载，避免对 body 开 subtree 观察（易 OOM）
    findTimer = (globalThis.setInterval ?? setInterval)(() => {
      findAttempts += 1;
      const found = resolveResultsWatchRoot(document);
      if (found) {
        clearFindTimer();
        const shell = findLayoutShell(document);
        const scope = shell?.contains(found) ? shell : found;
        attach(scope);
        attachNavWatches(scope);
        onChange();
        return;
      }
      if (findAttempts >= 40) clearFindTimer();
    }, 250);
  }

  return {
    /**
     * 自身 DOM 改写期间屏蔽观察，并用 takeRecords 丢掉已堆积记录，避免清 mute 后二次触发。
     * @template T
     * @param {() => T} fn
     * @returns {T}
     */
    runMuted(fn) {
      muteDepth += 1;
      document.documentElement.dataset[DOM_MUTE_FLAG] = "1";
      try {
        return fn();
      } finally {
        for (const obs of observers) obs.takeRecords?.();
        clearTimer();
        muteDepth -= 1;
        if (muteDepth === 0) delete document.documentElement.dataset[DOM_MUTE_FLAG];
      }
    },
    dispose() {
      clearFindTimer();
      for (const obs of observers) {
        try {
          obs.disconnect();
        } catch {
          // ignore
        }
      }
      observers.length = 0;
      observedScopes.clear();
      clearTimer();
      muteDepth = 0;
      delete document.documentElement.dataset[DOM_MUTE_FLAG];
    },
  };
}

/**
 * 扩展自身写入（bsp-* 节点、origin 注释、结果盒内外搬移的 bsp 子树）视为自有变更。
 * @param {MutationRecord} record
 */
function isOwnDomMutation(record) {
  if (isOwnDomNode(record.target)) return true;
  const touched = [];
  if (record.addedNodes?.length) touched.push(...record.addedNodes);
  if (record.removedNodes?.length) touched.push(...record.removedNodes);
  if (touched.length === 0) return false;
  return touched.every(isOwnDomNode);
}

/**
 * @param {Node | null | undefined} node
 */
function isOwnDomNode(node) {
  if (!node) return false;
  if (node.nodeType === 8) {
    return String(node.data ?? node.nodeValue ?? "").includes("bsp-origin");
  }
  if (node.nodeType === 3) {
    return isOwnDomElement(/** @type {Element | null} */ (node.parentElement));
  }
  if (node.nodeType !== 1) return false;
  return isOwnDomElement(/** @type {Element} */ (node));
}



export { attachScroll, isOwnDomMutation, resolveResultsWatchRoot, watchResults };
