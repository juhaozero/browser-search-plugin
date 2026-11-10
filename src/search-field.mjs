import { isDisplayed, rectOf } from "./layout-dom.mjs";

const searchFieldStyles = new WeakMap();

const SEARCH_FIELD_PROPS = ["width", "max-width", "min-width", "margin-left", "margin-right", "box-sizing", "flex-shrink"];

function restoreSearchField(document) {
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
function alignEngineSearchField(document, metrics) {
  if (document.getElementById("b_results")) {
    const field = document.querySelector("#sb_form .b_searchboxForm");
    if (field) alignSearchField(document, field, metrics.viewportWidth / 2, metrics.shellWidth, metrics.viewportWidth, "#b_header .b_logoArea, #id_h");
    return;
  }
  const form = document.querySelector("form#tsf, form[role='search']");
  const input = form?.querySelector("[name='q']");
  if (!input) return;
  const field = input.closest(".A8SBwf") ?? form;
  const results = rectOf(document.getElementById("bsp-results"));
  const center = results.width > 0 ? results.left + results.width / 2 : metrics.targetLeft + metrics.mainWidth / 2;
  alignSearchField(document, field, center, results.width || metrics.mainWidth, metrics.viewportWidth, "#gb, #logo, #hplogo, #google-logo");
}

function alignDuckDuckGoSearchField(document, results, viewportWidth) {
  const input = document.querySelector('#search_form_input, #searchbox_input, #search_form [name="q"], header form [name="q"]');
  const field = input?.closest("form, #search_form");
  if (!field) { restoreSearchField(document); return; }
  alignSearchField(document, field, results.left + results.width / 2, results.width, viewportWidth,
    ".header__logo-wrap, .header__logo, #logo_homepage_link, .header--aside, [data-testid='header-logo']");
}

function alignBaiduSearchField(document, results, viewportWidth) {
  const field = [...document.querySelectorAll("#head #chat-input-main, #head #form:not(.virtual-form):has(#kw)")]
    .find(element => element.checkVisibility?.({ visibilityProperty: true }) ?? isDisplayed(element));
  if (!field) { restoreSearchField(document); return; }
  alignSearchField(document, field, results.left + results.width / 2, results.width, viewportWidth, "#result_logo, #head #u");
}

function alignSearchField(document, field, center, maxWidth, viewportWidth, controls) {
  const initial = rectOf(field);
  if (!(initial.width > 0 && initial.height > 0)) return;
  const previous = searchFieldStyles.get(document);
  if (previous?.field !== field) {
    restoreSearchField(document);
    searchFieldStyles.set(document, { field, hadStyle:field.hasAttribute("style"),
      styles:SEARCH_FIELD_PROPS.map(prop => [prop, field.style.getPropertyValue(prop), field.style.getPropertyPriority(prop)]) });
  }
  let left = 16;
  let right = viewportWidth - 16;
  for (const control of document.querySelectorAll(controls)) {
    if (field.contains(control) || !isDisplayed(control)) continue;
    const r = rectOf(control);
    if (r.width <= 0 || r.height <= 0 || r.bottom <= initial.top || r.top >= initial.bottom) continue;
    if (r.left >= center) right = Math.min(right, r.left - 24);
    else if (r.right <= center) left = Math.max(left, r.right + 24);
  }
  const width = Math.min(maxWidth, 2 * Math.min(center - left, right - center));
  // Keep the native field when there is no usable slot at the result center.
  if (width < 180) { restoreSearchField(document); return; }
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

export { alignBaiduSearchField, alignDuckDuckGoSearchField, alignEngineSearchField, restoreSearchField };
