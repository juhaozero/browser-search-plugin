import { rectOf } from "./layout-dom.mjs";

// Google can put a fixed-width answer column and its controls inside a wide overview row.
export const GOOGLE_OVERVIEW = '#Odp5De, [data-attrid="SGE"], [data-attrid="AIOverview"], [data-ai-overview], div[jscontroller="EYwa3d"], div:has(> #m-x-content)';
export const BING_OVERVIEW = "#b_copilot_search_container, #b_copilot_search, #b_sydConvCont";
// Search Assist is a wikinlp module. Baidu renders AI answers as Baikan cards.
const DUCKDUCKGO_OVERVIEW = '[data-react-module-id="wikinlp"], [data-layout="wikinlp"]';
const BAIDU_BAIKAN = '[tpl="new_baikan_index"], [m-name="new_baikan_index"]';
export const BAIDU_OVERVIEW = `:is(${BAIDU_BAIKAN}, :has(> :is(${BAIDU_BAIKAN})))`;

const OVERVIEWS = {
  google: GOOGLE_OVERVIEW,
  bing: BING_OVERVIEW,
  duckduckgo: DUCKDUCKGO_OVERVIEW,
  baidu: `#content_left > ${BAIDU_OVERVIEW}`,
};
const CENTERED = "data-bsp-overview";
const ROW = "data-bsp-overview-row";
const OFFSET = "--bsp-overview-offset";
const ROW_SPACE = "--bsp-overview-row-space";
const MAX_WIDTH = "--bsp-overview-max-width";

/** @param {HTMLElement | null} [aside] */
export function alignOverviews(document, viewportWidth, aside = null) {
  const engine = document.documentElement.dataset.bspEngine;
  const selector = OVERVIEWS[engine];
  if (!selector || !viewportWidth) return;
  const overviews = new Set([...document.querySelectorAll(selector)].filter(element =>
    !element.parentElement?.closest(selector)
    && !element.closest('#rhs, #b_context, #content_right, [data-testid="sidebar"]')));
  for (const element of document.querySelectorAll(`[${CENTERED}]`)) {
    if (!overviews.has(element)) clearOverview(element);
  }

  const asideRect = rectOf(aside);
  for (const element of overviews) {
    element.setAttribute(CENTERED, "");
    element.style.removeProperty(OFFSET);
    element.style.removeProperty(ROW_SPACE);
    element.style.removeProperty(MAX_WIDTH);
    let { width, left, top, bottom } = rectOf(element);
    if (!width) continue;
    const column = engine === "google" ? googleOverviewColumn(element) : null;
    const contentWidth = rectOf(column).width;
    if (contentWidth > 0 && contentWidth < width) {
      element.style.setProperty(MAX_WIDTH, `${contentWidth}px`);
      ({ width, left, top, bottom } = rectOf(element));
    }
    if (element.hasAttribute(ROW)) {
      const available = element.parentElement.clientWidth;
      element.style.setProperty(ROW_SPACE, `${Math.max(0, available - width)}px`);
      ({ left } = rectOf(element));
    } else if (asideRect.width > 0 && top < asideRect.bottom && bottom > asideRect.top) {
      // An overview inside the main column can share its vertical space with the sidebar.
      const clearWidth = 2 * asideRect.left - viewportWidth;
      if (clearWidth > 0 && clearWidth < width) {
        element.style.setProperty(MAX_WIDTH, `${clearWidth}px`);
        ({ width, left } = rectOf(element));
      }
    }
    const columnRect = rectOf(column);
    if (columnRect.width > 0 && columnRect.width <= width) {
      ({ width, left } = columnRect);
    }
    element.style.setProperty(OFFSET, `${(viewportWidth - width) / 2 - left}px`);
  }
}

function googleOverviewColumn(element) {
  const content = element.querySelector("#m-x-content");
  if (!content || rectOf(element.querySelector('[data-container-id="right-col"]')).width > 0) return null;
  return content.querySelector('[data-container-id="main-col"]')
    ?? content.querySelector("[data-rl]")
    ?? content.querySelector(":scope > div:only-child")
    ?? content;
}

export function clearOverviews(document) {
  for (const element of document.querySelectorAll(`[${CENTERED}], [${ROW}]`)) clearOverview(element);
}

function clearOverview(element) {
  element.removeAttribute(CENTERED);
  element.removeAttribute(ROW);
  element.style.removeProperty(OFFSET);
  element.style.removeProperty(ROW_SPACE);
  element.style.removeProperty(MAX_WIDTH);
}
