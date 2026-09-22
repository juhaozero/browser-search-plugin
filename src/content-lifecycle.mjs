/**
 * Content-script boot 生命周期：用世代号避免 SPA 快速导航时并发 boot 泄漏 observer。
 */

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
    if (!deps.isDesktopWebSearch(url)) {
      bootGeneration += 1;
      active?.dispose?.();
      active = null;
      lastUrl = url;
      return null;
    }
    if (active && lastUrl === url && reason === "navigate") return active;

    const generation = ++bootGeneration;
    active?.dispose?.();
    active = null;
    lastUrl = url;

    const next = await deps.bootSearchPage(document, url);
    if (generation !== bootGeneration) {
      next?.dispose?.();
      return null;
    }
    active = next;
    return active;
  }

  function getActive() {
    return active;
  }

  return { start, getActive };
}
