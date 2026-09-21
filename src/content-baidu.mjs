import { bootSearchPage, alignSingleCenter } from "./content-boot.mjs";

/**
 * @param {Document} document
 * @param {string} url
 * @param {{ viewportWidth?: number, parentLeft?: number }} [layout]
 * @param {object} [deps]
 */
export async function bootBaiduPage(document, url, layout = {}, deps = {}) {
  try {
    const host = new URL(url).hostname;
    if (host !== "www.baidu.com") return null;
  } catch {
    return null;
  }
  return bootSearchPage(document, url, layout, deps);
}

export { alignSingleCenter, bootSearchPage };
