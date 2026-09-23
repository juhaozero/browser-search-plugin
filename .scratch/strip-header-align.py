from pathlib import Path

path = Path(r"e:\github\browser-search-plugin\src\content-boot.mjs")
text = path.read_text(encoding="utf-8")
start = text.find("/**\n * @param {Document} document\n */\nfunction collectHeaderBands")
end = text.find(
  "/**\n * 同一条祖先链上只定宽一次，防止双重位移。\n"
  " * @param {HTMLElement | null} el\n"
  " * @param {number} widthPx\n"
  " * @param {number} targetLeft\n"
  " * @param {Set<HTMLElement>} placed\n"
  " */\nfunction placeShellOnce"
)
if start < 0 or end < 0:
  raise SystemExit(f"markers not found: start={start} end={end}")

keep = r'''/**
 * 安全取几何：没有 getBoundingClientRect（极简/测试 DOM）时返回零矩形而不是抛错。
 * @param {HTMLElement | null | undefined} el
 */
function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  return el.getBoundingClientRect();
}

/**
 * 结果壳定位：定宽后用 relative + left 对齐视口目标。
 * @param {HTMLElement} el
 * @param {number} widthPx
 * @param {number} targetLeft
 */
function alignBandToTarget(el, widthPx, targetLeft) {
  stampCentered(el);
  const maxW = `min(${widthPx}px, calc(100vw - ${SIDE_GAP * 2}px))`;
  el.style.setProperty("position", "relative", "important");
  el.style.setProperty("top", "0", "important");
  el.style.setProperty("bottom", "auto", "important");
  el.style.setProperty("right", "auto", "important");
  el.style.setProperty("width", `${widthPx}px`, "important");
  el.style.setProperty("max-width", maxW, "important");
  el.style.setProperty("min-width", "0", "important");
  el.style.setProperty("padding-left", "0", "important");
  el.style.setProperty("padding-right", "0", "important");
  el.style.setProperty("margin-left", "0", "important");
  el.style.setProperty("margin-right", "0", "important");
  el.style.setProperty("box-sizing", "border-box", "important");
  el.style.setProperty("float", "none", "important");
  el.style.setProperty("transform", "none", "important");
  el.style.setProperty("overflow", "visible", "important");
  settleLeft(el, targetLeft);
}

/**
 * 闭环校正左缘：先归零量一次，写出 relative 位移，再复测并补掉残差。
 * @param {HTMLElement} el
 * @param {number} targetLeft
 */
function settleLeft(el, targetLeft) {
  el.style.setProperty("left", "0", "important");
  const base = rectOf(el).left;
  let offset = clampNavOffset(base, Math.round(targetLeft - base));
  el.style.setProperty("left", `${offset}px`, "important");
  for (let round = 0; round < 2; round += 1) {
    const residual = Math.round(targetLeft - rectOf(el).left);
    if (residual === 0) break;
    offset = clampNavOffset(base, offset + residual);
    el.style.setProperty("left", `${offset}px`, "important");
  }
}

/**
 * 别把左缘推出视口。
 * @param {number} base
 * @param {number} offset
 */
function clampNavOffset(base, offset) {
  if (base + offset < SIDE_GAP) return Math.round(SIDE_GAP - base);
  return offset;
}

'''

path.write_text(text[:start] + keep + text[end:], encoding="utf-8")
print("ok", path.stat().st_size)
