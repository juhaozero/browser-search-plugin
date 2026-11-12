import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { bootSearchPage, alignResultsBox, layoutMetrics } from "../src/content-boot.mjs";
import { createSearchSession } from "../src/search-session.mjs";
import { aiMarkup, searchPage } from "./fixtures/search-page.mjs";

test("Google 顶部 AI 独占一行，新增/替换节点使壳缓存失效", async () => {
  const { document } = parseHTML(searchPage());
  const boot = await bootSearchPage(document, "https://www.google.com/search?q=test", { viewportWidth:1920 },
    { prefs:{ columnMode:"double", autoPage:false }, attachScroll:false, watchDom:false });
  const shell = document.getElementById("rcnt");
  assert.equal(shell.style.flexWrap, "nowrap");
  shell.insertAdjacentHTML("afterbegin", aiMarkup());
  alignResultsBox(document.getElementById("bsp-results"), 1920);
  assert.equal(shell.style.flexWrap, "wrap");
  assert.ok(document.getElementById("ai-overview").hasAttribute("data-bsp-overview-row"));
  const replacement = document.getElementById("ai-overview").cloneNode(true);
  document.getElementById("ai-overview").replaceWith(replacement);
  replacement.removeAttribute("data-bsp-overview-row");
  alignResultsBox(document.getElementById("bsp-results"), 1920);
  assert.ok(replacement.hasAttribute("data-bsp-overview-row"));
  boot.dispose();
  assert.equal(document.querySelector("[data-bsp-overview], [data-bsp-overview-row]"), null);
});

test("AI 引用不搬入结果，顶部 AI 顺序和原始 DOM 可恢复", () => {
  const { document } = parseHTML(searchPage({ ai:true, placement:"inner" }));
  const root = document.getElementById("rso");
  const before = root.innerHTML;
  const session = createSearchSession(document, "https://www.google.com/search?q=test", { columnMode:"double" });
  assert.equal(document.querySelectorAll("#bsp-results > .g").length, 3);
  assert.ok(document.querySelector("#ai-overview .g"));
  assert.equal(root.firstElementChild.id, "ai-overview");
  assert.ok(root.hasAttribute("data-bsp-results-path"));
  session.dispose();
  assert.equal(root.innerHTML, before);
  assert.equal(document.querySelector("[data-bsp-results-path]"), null);
});

test("390px 下侧栏另起一行，主列和总壳不超过可用宽度", () => {
  const { document } = parseHTML(searchPage());
  const metrics = layoutMetrics(document, "double", 390);
  assert.equal(metrics.stackAside, true);
  assert.equal(metrics.mainWidth, 326);
  assert.equal(metrics.shellWidth, 326);
});
