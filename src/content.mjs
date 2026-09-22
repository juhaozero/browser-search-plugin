import { bootSearchPage, isDesktopWebSearch } from "./content-entry.mjs";
import { createContentLifecycle, isExtensionContextValid } from "./content-lifecycle.mjs";

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
      // 解到原生实现，避免重入时层层包装
      if (original.__bspOriginal) original = original.__bspOriginal;
      function patched(...args) {
        const result = original.apply(this, args);
        queueMicrotask(() => {
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
