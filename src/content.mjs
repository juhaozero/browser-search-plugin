import { bootSearchPage, isDesktopWebSearch } from "./content-entry.mjs";
import {
  createContentLifecycle,
  isExtensionContextValid,
  searchPageKey,
} from "./content-lifecycle.mjs";

const GLOBAL_KEY = "__bspContentController";

/** 同一 JS 世界重复执行时先拆掉旧实例，避免叠加 MutationObserver */
const previous = globalThis[GLOBAL_KEY];
if (previous && typeof previous.disposeAll === "function") {
  try {
    previous.disposeAll();
  } catch {
    // ignore
  }
}

const lifecycle = createContentLifecycle({ bootSearchPage, isDesktopWebSearch });

async function start(reason = "boot") {
  if (!isExtensionContextValid()) {
    lifecycle.disposeAll();
    return;
  }
  await lifecycle.start(document, location.href, reason);
}

function onPopState() {
  globalThis[GLOBAL_KEY]?.onNavigate?.();
}

function onNavigate() {
  void start("navigate");
}

/** @type {number | undefined} */
let contextGuardTimer;

function installContextGuard(view) {
  if (!view || typeof view.setInterval !== "function") return;
  contextGuardTimer = view.setInterval(() => {
    if (isExtensionContextValid()) return;
    disposeController();
  }, 1500);
}

function disposeController() {
  try {
    lifecycle.disposeAll();
  } catch {
    // ignore
  }
  const view = document.defaultView;
  if (view && contextGuardTimer != null) {
    view.clearInterval(contextGuardTimer);
    contextGuardTimer = undefined;
  }
  try {
    view?.removeEventListener?.("popstate", onPopState);
  } catch {
    // ignore
  }
  try {
    unwrapHistory(view);
  } catch {
    // ignore
  }
  if (globalThis[GLOBAL_KEY]?.disposeAll === disposeController) {
    delete globalThis[GLOBAL_KEY];
  }
}

/**
 * @param {Window | null | undefined} view
 */
function unwrapHistory(view) {
  if (!view?.history) return;
  for (const method of ["pushState", "replaceState"]) {
    const fn = view.history[method];
    if (fn && fn.__bspOriginal) view.history[method] = fn.__bspOriginal;
  }
}

globalThis[GLOBAL_KEY] = {
  disposeAll: disposeController,
  onNavigate,
  lifecycle,
};

if (typeof location !== "undefined" && typeof document !== "undefined" && location.href) {
  void start("boot");
  const view = document.defaultView;
  if (view) {
    view.addEventListener("popstate", onPopState);
    installContextGuard(view);
    const wrap = (method) => {
      let original = view.history[method];
      if (typeof original !== "function") return;
      if (original.__bspOriginal) original = original.__bspOriginal;
      function patched(...args) {
        const beforeKey = searchPageKey(location.href);
        const result = original.apply(this, args);
        voidMicrotask(() => {
          // 仅当查询身份变化时 reboot；追踪参数变化忽略
          if (searchPageKey(location.href) === beforeKey) return;
          globalThis[GLOBAL_KEY]?.onNavigate?.();
        });
        return result;
      }
      patched.__bspPatched = true;
      patched.__bspOriginal = original;
      view.history[method] = patched;
    };
    wrap("pushState");
    wrap("replaceState");
  }
}
