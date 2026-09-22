/**
 * Content-script boot 生命周期：用世代号避免 SPA 快速导航时并发 boot 泄漏 observer。
 */

/**
 * 扩展被 reload 后旧 content script 仍会跑，但 chrome.runtime 已失效；此时必须拆掉 observer。
 * 仅在访问 runtime 抛错时视为失效（Chrome 失效上下文的特征），避免误杀正常 boot。
 * @returns {boolean}
 */
export function isExtensionContextValid() {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime) return true;
    // 失效时读取 id 会抛错；正常内容脚本始终有 id
    return typeof chrome.runtime.id === "string" && chrome.runtime.id.length > 0;
  } catch {
    return false;
  }
}

/**
 * 只用引擎+查询词识别搜索页，忽略 rsv_/oq 等追踪参数，避免 replaceState 触发无意义 reboot。
 * @param {string} url
 * @returns {string}
 */
export function searchPageKey(url) {
  try {
    const parsed = new URL(url);
    const wd = parsed.searchParams.get("wd");
    const q = parsed.searchParams.get("q");
    if (parsed.hostname === "www.baidu.com" && parsed.pathname === "/s" && wd != null) {
      return `baidu:${wd}`;
    }
    if (/google\./.test(parsed.hostname) && parsed.pathname === "/search" && q != null) {
      return `google:${parsed.hostname}:${q}`;
    }
    return `${parsed.origin}${parsed.pathname}?${wd ?? q ?? parsed.search}`;
  } catch {
    return url;
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
  let lastKey = "";
  /** 正在 boot 的搜索页 key；同查询 navigate 在完成前合并 */
  let bootingKey = "";
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
    const key = searchPageKey(url);
    if (!deps.isDesktopWebSearch(url)) {
      bootGeneration += 1;
      bootingKey = "";
      const prev = active;
      active = null;
      lastKey = key;
      try {
        prev?.dispose?.();
      } catch {
        // ignore
      }
      return null;
    }
    // 已激活或正在 boot 同一查询时，忽略 navigate（加载期 replaceState 会改追踪参数）
    if (reason === "navigate") {
      if (active && lastKey === key) return active;
      if (bootingKey === key) return active;
    }

    const generation = ++bootGeneration;
    const prev = active;
    active = null;
    lastKey = key;
    bootingKey = key;
    try {
      prev?.dispose?.();
    } catch {
      // ignore
    }

    let next = null;
    try {
      next = await deps.bootSearchPage(document, url);
    } catch {
      if (generation === bootGeneration) bootingKey = "";
      return null;
    }

    if (!isExtensionContextValid() || generation !== bootGeneration) {
      try {
        next?.dispose?.();
      } catch {
        // ignore
      }
      return null;
    }
    active = next;
    bootingKey = "";
    return active;
  }

  function getActive() {
    return active;
  }

  function disposeAll() {
    bootGeneration += 1;
    bootingKey = "";
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
