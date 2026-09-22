import { bootSearchPage, isDesktopWebSearch } from "./content-entry.mjs";
import { createContentLifecycle } from "./content-lifecycle.mjs";

const lifecycle = createContentLifecycle({ bootSearchPage, isDesktopWebSearch });

async function start(reason = "boot") {
  await lifecycle.start(document, location.href, reason);
}

if (typeof location !== "undefined" && typeof document !== "undefined" && location.href) {
  void start("boot");
  const view = document.defaultView;
  if (view) {
    view.addEventListener("popstate", () => {
      void start("navigate");
    });
    const wrap = (method) => {
      const original = view.history[method];
      if (typeof original !== "function") return;
      view.history[method] = function patched(...args) {
        const result = original.apply(this, args);
        queueMicrotask(() => {
          void start("navigate");
        });
        return result;
      };
    };
    wrap("pushState");
    wrap("replaceState");
  }
}
