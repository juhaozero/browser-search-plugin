/**
 * Content-script boot 生命周期：用世代号避免 SPA 快速导航时并发 boot 泄漏 observer。
 */

/**
 * 扩展被 reload 后旧 content script 仍会跑，但 chrome.runtime 已失效；此时必须拆掉 observer。
 * @returns {boolean}
 */
export function isExtensionContextValid() {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime) return true;
    return Boolean(chrome.runtime.id);
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   bootSearchPage: (document: Document, url: string) => Promise<{ dispose?: () => void } | null>,
 *   isDesktopWebSearch: (url: string) => boolean,
 * }} deps
 */
export function createContentLifecycle(deps) {
  let active = null;
  let lastUrl = "";
  let bootGeneration = 0;

  /**
   * @param {Document} document
   * @param {string} url
   * @param {string} [reason]
   */
  async function start(document, url, reason = "boot") {
    if (!isExtensionContextValid()) {
      disposeAll();
      return null;
    }
    if (!deps.isDesktopWebSearch(url)) {
      bootGeneration += 1;
      const prev = active;
      active = null;
      lastUrl = url;
      try {
        prev?.dispose?.();
      } catch {
        // ignore
      }
      return null;
    }
    if (active && lastUrl === url && reason === "navigate") return active;

    const generation = ++bootGeneration;
    const prev = active;
    active = null;
    lastUrl = url;
    try {
      prev?.dispose?.();
    } catch {
      // ignore
    }

    const next = await deps.bootSearchPage(document, url);
    if (!isExtensionContextValid() || generation !== bootGeneration) {
      try {
        next?.dispose?.();
      } catch {
        // ignore
      }
      return null;
    }
    active = next;
    return active;
  }

  function getActive() {
    return active;
  }

  function disposeAll() {
    bootGeneration += 1;
    const prev = active;
    active = null;
    try {
      prev?.dispose?.();
    } catch {
      // dispose 内部已尽量吞错；这里再兜一层避免 disposeAll 中断
    }
  }

  return { start, getActive, disposeAll };
}
