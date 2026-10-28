import { isDisplayed, rectOf } from "./layout-dom.mjs";

const searchFieldStyles = new WeakMap();

const SEARCH_FIELD_PROPS = ["width", "max-width", "min-width", "margin-left", "margin-right", "box-sizing", "flex-shrink"];

function restoreGoogleSearchField(document) {
  const saved = searchFieldStyles.get(document);
  if (!saved) return;
  for (const [prop, value, priority] of saved.styles) {
    if (value) saved.field.style.setProperty(prop, value, priority);
    else saved.field.style.removeProperty(prop);
  }
  if (!saved.hadStyle && !saved.field.style.cssText) saved.field.removeAttribute("style");
  searchFieldStyles.delete(document);
}

// Move only the visible search field, never the full header/account containing block.
// Measure the result column and reserve symmetric space for native controls.
function alignGoogleSearchField(document, metrics) {
  if (document.getElementById("b_results")) return;
  const form = document.querySelector("form#tsf, form[role='search']");
  const input = form?.querySelector("[name='q']");
  if (!input) return;
  const field = input.closest(".A8SBwf") ?? form;
  const initial = rectOf(field);
  if (!(initial.width > 0 && initial.height > 0)) return;
  const previous = searchFieldStyles.get(document);
  if (previous?.field !== field) {
    restoreGoogleSearchField(document);
    searchFieldStyles.set(document, { field, hadStyle:field.hasAttribute("style"),
      styles:SEARCH_FIELD_PROPS.map(prop => [prop, field.style.getPropertyValue(prop), field.style.getPropertyPriority(prop)]) });
  }
  const box = document.getElementById("bsp-results");
  const results = rectOf(box);
  const center = results.width > 0 ? results.left + results.width / 2 : metrics.targetLeft + metrics.mainWidth / 2;
  let left = 16;
  let right = metrics.viewportWidth - 16;
  for (const control of document.querySelectorAll("#gb, #logo, #hplogo, #google-logo")) {
    if (field.contains(control) || !isDisplayed(control)) continue;
    const r = rectOf(control);
    if (r.width <= 0 || r.height <= 0 || r.bottom <= initial.top || r.top >= initial.bottom) continue;
    if (r.left >= center) right = Math.min(right, r.left - 24);
    else if (r.right <= center) left = Math.max(left, r.right + 24);
  }
  const width = Math.min(results.width || metrics.mainWidth, 2 * Math.min(center - left, right - center));
  // Keep the native field when there is no usable slot at the result center.
  if (width < 180) { restoreGoogleSearchField(document); return; }
  field.style.setProperty("width", `${width}px`, "important");
  field.style.setProperty("max-width", "none", "important");
  field.style.setProperty("min-width", "0", "important");
  field.style.setProperty("box-sizing", "border-box", "important");
  field.style.setProperty("flex-shrink", "0", "important");
  field.style.setProperty("margin-left", "0", "important");
  field.style.setProperty("margin-right", "0", "important");
  // Grid/flex parents may contribute their own offset. Correct actual geometry,
  // rather than adding the viewport offset to a native logo gutter a second time.
  for (let pass = 0; pass < 3; pass++) {
    const r = rectOf(field);
    const delta = center - (r.left + r.width / 2);
    if (Math.abs(delta) < 0.5) break;
    const current = Number.parseFloat(field.style.marginLeft) || 0;
    field.style.setProperty("margin-left", `${current + delta}px`, "important");
    field.style.setProperty("margin-right", `${-(current + delta)}px`, "important");
  }
}

export { alignGoogleSearchField, restoreGoogleSearchField };
