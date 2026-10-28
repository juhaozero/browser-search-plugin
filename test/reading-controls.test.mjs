import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { DEFAULT_PREFS, createMemoryPrefsStore, normalizePrefs } from "../src/preferences.mjs";
import { createPageAppearance } from "../src/page-appearance.mjs";
import { bootSearchPage } from "../src/boot.mjs";
import { layoutMetrics } from "../src/shell-layout.mjs";
import { createLocaleStore } from "../src/i18n.mjs";
import { mountPopup, readForm } from "../src/popup.mjs";

test("新偏好兼容旧存储，并校验枚举、数值范围与类型", () => {
  assert.deepEqual(normalizePrefs({ columnMode: "double", autoPage: false }), { ...DEFAULT_PREFS, columnMode: "double", autoPage: false });
  assert.deepEqual(normalizePrefs({
    cardDensity: "bad", maxColumnWidth: Infinity, pagesPerBatch: 0, nearBottomPx: -1,
    adsMode: "delete", googleSidebar: 1, bingSidebar: "true", showAI: null, autoContinue: "yes",
  }), DEFAULT_PREFS);
  assert.equal(normalizePrefs({ maxColumnWidth: 1601 }).maxColumnWidth, 0);
  assert.equal(normalizePrefs({ pagesPerBatch: 51 }).pagesPerBatch, 10);
  assert.equal(normalizePrefs({ nearBottomPx: "1000" }).nearBottomPx, 800);
});

test("真实弹窗控件完整读写四组偏好，语言切换不重置选项", async () => {
  const { document } = parseHTML(readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8"));
  const store = createMemoryPrefsStore();
  const popup = await mountPopup(document, { prefsStore: store, localeStore: createLocaleStore() });
  const selected = { ...DEFAULT_PREFS, cardDensity: "compact", maxColumnWidth: 540,
    googleSidebar: false, bingSidebar: true, showAI: false, adsMode: "collapse",
    pagesPerBatch: 3, nearBottomPx: 1200, autoContinue: true };
  for (const [key, value] of Object.entries(selected)) {
    if (key === "columnMode") continue;
    const input = document.querySelector(`[name='${key}']`);
    if (typeof value === "boolean") input.checked = value;
    else if (input.tagName === "SELECT") {
      for (const option of input.querySelectorAll("option")) if (option.value === value) option.selected = true;
    } else input.value = String(value);
  }
  await popup.commit();
  assert.deepEqual(await store.load(), selected);
  await popup.setLocale("zh");
  assert.deepEqual(readForm(document), selected);
  assert.equal(document.querySelector("[data-i18n='adsCollapse']").textContent, "折叠");
});

test("广告折叠保留节点和事件，处理晚到广告，切换模式与释放时还原", () => {
  const { document } = parseHTML('<html><body><div id="tads"><a id="ad" href="https://example.com/ad">Ad</a></div><div id="rso"><div class="g"><h3>Organic</h3></div></div><div id="bottomads"></div></body></html>');
  const appearance = createPageAppearance(document);
  const link = document.getElementById("ad");
  const organic = document.querySelector(".g");
  let clicks = 0;
  link.addEventListener("click", () => { clicks++; });
  const prefs = { ...DEFAULT_PREFS, adsMode: "collapse" };
  appearance.apply(prefs, "zh");
  assert.equal(document.querySelector("#bottomads details"), null);
  assert.equal(link.closest("details")?.className, "bsp-ad-fold");
  assert.equal(document.querySelector("#tads summary").textContent, "广告 — 展开查看");
  const fold = document.querySelector("#tads details");
  fold.setAttribute("open", "");
  const late = document.createElement("a");
  late.textContent = "Late ad";
  document.getElementById("bottomads").appendChild(late);
  appearance.apply(prefs, "en");
  assert.equal(document.querySelector("#tads details"), fold);
  assert.equal(fold.hasAttribute("open"), true);
  assert.equal(late.closest("details").className, "bsp-ad-fold");
  assert.equal(organic.closest("details"), null);
  appearance.apply({ ...prefs, adsMode: "dim" }, "en");
  assert.equal(link.parentElement.id, "tads");
  assert.equal(document.querySelector("details"), null);
  assert.ok(link.parentElement.hasAttribute("data-bsp-ad-region"));
  link.click();
  assert.equal(clicks, 1);
  appearance.dispose();
  assert.equal(document.querySelector("[data-bsp-ad-region]"), null);
  assert.equal(document.querySelector(".g"), organic);
  assert.equal(late.parentElement.id, "bottomads");
});

test("广告标记混入自然结果时保守跳过，不包裹自然结果", () => {
  const { document } = parseHTML('<html><body><div id="tads"><div class="g"><h3>Organic</h3></div></div></body></html>');
  const appearance = createPageAppearance(document);
  appearance.apply({ ...DEFAULT_PREFS, adsMode: "collapse" }, "en");
  assert.equal(document.querySelector("details"), null);
  assert.equal(document.querySelector("[data-bsp-ad-region]"), null);
  appearance.dispose();
});

test("宽度、密度、Google 侧栏设置即时生效，关闭时恢复原有变量", async () => {
  const { document } = parseHTML('<html><body><div id="rcnt"><div id="center_col"><div id="rso"><div class="g"><a href="https://example.com"><h3>Organic</h3></a></div></div></div><aside id="rhs">Knowledge</aside></div></body></html>');
  document.documentElement.style.setProperty("--bsp-single-max", "900px");
  const boot = await bootSearchPage(document, "https://www.google.com/search?q=test", { viewportWidth: 1400 }, {
    prefs: { maxColumnWidth: 520, googleSidebar: false, cardDensity: "compact" }, attachScroll: false, watchDom: false,
  });
  assert.equal(layoutMetrics(document, "single-center", 1400).mainWidth, 520);
  assert.equal(layoutMetrics(document, "single-center", 1400).hasAside, false);
  assert.equal(document.documentElement.dataset.bspDensity, "compact");
  boot.applyPrefs({ maxColumnWidth: 400, columnMode: "double", googleSidebar: false });
  assert.equal(layoutMetrics(document, "double", 1400).mainWidth, 824);
  boot.dispose();
  assert.equal(document.documentElement.style.getPropertyValue("--bsp-single-max"), "900px");
  assert.equal(document.documentElement.hasAttribute("data-bsp-density"), false);
});

test("Bing 侧栏从硬隐藏改为可恢复，显示时参与宽度预算", async () => {
  const { document } = parseHTML('<html><body><div id="b_content"><main><ol id="b_results"><li class="b_algo"><h2><a href="https://example.com">Result</a></h2></li></ol></main><aside id="b_context">Sidebar</aside></div></body></html>');
  const boot = await bootSearchPage(document, "https://www.bing.com/search?q=test", { viewportWidth: 1400 }, { attachScroll: false, watchDom: false });
  const aside = document.getElementById("b_context");
  assert.equal(aside.style.display, "none");
  boot.applyPrefs({ bingSidebar: true });
  assert.equal(aside.style.display, "block");
  assert.equal(layoutMetrics(document, "single-center", 1400).hasAside, true);
  boot.applyPrefs({ bingSidebar: false });
  assert.equal(aside.style.display, "none");
  boot.dispose();
  assert.notEqual(aside.style.display, "none");
});

test("Bing 侧栏隐藏不把底部广告区当成侧栏", async () => {
  const { document } = parseHTML('<html><body><div id="b_mcw"><ol id="b_results"><li class="b_algo"><h2><a href="https://example.com">Result</a></h2></li></ol><div id="b_adBottom"><a href="https://example.com/ad">Ad</a></div><aside id="b_context">Sidebar</aside></div></body></html>');
  const boot = await bootSearchPage(document, "https://www.bing.com/search?q=test", { viewportWidth: 1400 }, {
    prefs: { adsMode: "collapse" }, attachScroll: false, watchDom: false,
  });
  assert.notEqual(document.getElementById("b_adBottom").style.display, "none");
  assert.ok(document.querySelector("#b_adBottom details"));
  boot.dispose();
  assert.equal(document.querySelector("#b_adBottom a").parentElement.id, "b_adBottom");
});
