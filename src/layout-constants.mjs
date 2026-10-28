

/** 布局尺寸的权威值；构建时自动写入 content.css 的生成区。 */
const SINGLE_SHELL_MAX = 1100;

/** 双列壳宽：两卡总宽。 */
const DOUBLE_SHELL_MAX = 1320;

const SIDE_GAP = 32;

const ASIDE_GAP = 28;

const ASIDE_MAX = 360;

/** 结果卡片间距。 */
const CARD_GAP = 22;

const CARD_COLUMN_GAP = 24;

export const LAYOUT_CSS_VARIABLES = {
  "--bsp-single-max": `${SINGLE_SHELL_MAX}px`,
  "--bsp-double-max": `${DOUBLE_SHELL_MAX}px`,
  "--bsp-card-gap": `${CARD_GAP}px`,
  "--bsp-card-column-gap": `${CARD_COLUMN_GAP}px`,
  "--bsp-side-gap": `${SIDE_GAP * 2}px`,
};

const CENTERED_STYLE_PROPS = [
  "width",
  "max-width",
  "min-width",
  "margin-left",
  "margin-right",
  "padding-left",
  "padding-right",
  "padding-inline-start",
  "margin-inline-start",
  "float",
  "left",
  "right",
  "transform",
  "display",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-self",
  "text-align",
  "gap",
  "flex",
  "flex-shrink",
  "flex-grow",
  "position",
  "box-sizing",
  "top",
  "bottom",
  "grid-template-columns",
  "grid-column",
  "justify-self",
  "margin-top",
  "margin-bottom",
  "clear",
  "height",
  "max-height",
  "overflow",
];

const ASIDE_IDS = ["rhs", "b_context"];

/** 结果列外壳：谷歌 #rcnt；必应旧版 #b_mcw；新版无 mcw 时用 #b_content */
const LAYOUT_SHELL_IDS = ["rcnt", "b_mcw", "b_content"];

/** 顶部 AI/通栏答案独占一行，结果列与侧栏排在下一行 */
const WRAPPING_SHELL_IDS = new Set(["rcnt", "b_mcw", "b_content"]);

const RELAYOUT_FLAG = "bspRelayout";

/** 自身 DOM 改写期间屏蔽 MutationObserver，避免 refresh/搬移结果节点形成反馈环 */
const DOM_MUTE_FLAG = "bspDomMute";

/** 必应顶栏导航：稳定结构，不依赖文案兜底 */
const BING_NAV_TAB_SELECTOR = "nav.b_scopebar > ul > li > a";

export { ASIDE_GAP, ASIDE_IDS, ASIDE_MAX, BING_NAV_TAB_SELECTOR, CARD_COLUMN_GAP, CARD_GAP, CENTERED_STYLE_PROPS, DOM_MUTE_FLAG, DOUBLE_SHELL_MAX, LAYOUT_SHELL_IDS, RELAYOUT_FLAG, SIDE_GAP, SINGLE_SHELL_MAX, WRAPPING_SHELL_IDS };
