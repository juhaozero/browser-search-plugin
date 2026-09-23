import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { alignSingleCenter, bootBaiduPage } from "../src/content-baidu.mjs";
import { contentWidth, layoutMetrics } from "../src/content-boot.mjs";

test("百度网页搜索默认单列居中并给不同高亮段不同标记", async () => {
  const { document } = parseHTML(baiduPage("chrome 扩展"));
  const boot = await bootBaiduPage(document, "https://www.baidu.com/s?wd=chrome%20%E6%89%A9%E5%B1%95", {
    viewportWidth: 1200,
    parentLeft: 80,
  }, { attachScroll: false });
  assert.ok(boot?.session);
  const box = document.getElementById("bsp-results");
  assert.equal(box.dataset.mode, "single-center");
  assert.equal(box.style.width, "100%");
  const expected = contentWidth("single-center", 1200);
  const left = Math.max(24, Math.round((1200 - expected) / 2));
  assert.equal(document.getElementById("content_left").style.width, `${expected}px`);
  assert.equal(document.getElementById("content_left").style.marginLeft, `${left}px`);
  // 顶栏与结果列同宽居中
  assert.equal(document.getElementById("head").style.width, `${expected}px`);
  assert.equal(document.getElementById("head").dataset.bspCentered, "1");
  assert.equal(document.querySelector("h3 mark.bsp-hl"), null);
  assert.equal(document.querySelector("#kw mark"), null);
  assert.equal(document.querySelector("#rs mark"), null);
  assert.equal(document.getElementById("page").textContent, "下一页");
  assert.equal(box.contains(document.getElementById("rs")), false);
  assert.deepEqual([...document.querySelectorAll("[id^='bsp-']")].map((element) => element.id), ["bsp-results"]);
});

test("首页、手机版和资讯页不改页面", async () => {
  for (const url of [
    "https://www.baidu.com/",
    "https://m.baidu.com/s?wd=chrome",
    "https://www.baidu.com/s?wd=chrome&tn=news",
  ]) {
    const { document } = parseHTML(baiduPage("chrome"));
    assert.equal(await bootBaiduPage(document, url), null);
    assert.equal(document.getElementById("bsp-results"), null);
    assert.equal(document.querySelector("mark"), null);
  }
});

test("单列居中按视口把结果列放到页面中间", () => {
  const { document } = parseHTML(`
    <form id="form"></form>
    <div id="content_left"><div id="bsp-results" data-mode="single-center"></div></div>
  `);
  const box = document.getElementById("bsp-results");
  alignSingleCenter(box, 1000);
  const expected = contentWidth("single-center", 1000);
  const left = Math.max(24, Math.round((1000 - expected) / 2));
  assert.equal(document.getElementById("content_left").style.width, `${expected}px`);
  assert.equal(document.getElementById("content_left").style.marginLeft, `${left}px`);
  assert.equal(box.style.width, "100%");
  alignSingleCenter(box, 400);
  assert.equal(document.getElementById("content_left").style.width, `${contentWidth("single-center", 400)}px`);
});

test("谷歌搜索框与结果列共用同一居中宽度", () => {
  const { document } = parseHTML(`
    <div id="searchform"><form id="tsf" role="search"></form></div>
    <div id="appbar"></div>
    <div id="center_col"><div id="bsp-results" data-mode="single-center"></div></div>
  `);
  const box = document.getElementById("bsp-results");
  alignSingleCenter(box, 1200);
  const expected = contentWidth("single-center", 1200);
  const form = document.getElementById("searchform");
  assert.equal(form.style.width, `${expected}px`);
  assert.equal(form.dataset.bspCentered, "1");
  assert.equal(form.style.marginLeft, "auto");
  assert.equal(form.style.marginRight, "auto");
  assert.equal(form.style.left, "auto");
  assert.equal(document.getElementById("appbar").style.width, `${expected}px`);
  assert.equal(document.getElementById("center_col").style.width, `${expected}px`);
  assert.equal(document.getElementById("tsf").style.width, "");
});

test("壳宽未变时再次居中不改写顶栏，避免闪跳", () => {
  const { document } = parseHTML(`
    <div id="searchform"></div>
    <div id="center_col"><div id="bsp-results" data-mode="single-center"></div></div>
  `);
  const box = document.getElementById("bsp-results");
  alignSingleCenter(box, 1200);
  document.documentElement.dataset.bspColumnMode = "single-center";
  const form = document.getElementById("searchform");
  form.style.setProperty("left", "12px");
  alignSingleCenter(box, 1200);
  // 跳过重排时应保留现有样式，而不是清掉再追像素
  assert.equal(form.style.left, "12px");
  assert.equal(form.dataset.bspCentered, "1");
});

test("有右侧知识卡时给结果列预留空间避免重叠", () => {
  const { document } = parseHTML(`
    <div id="searchform"></div>
    <div id="rcnt">
      <div id="center_col"><div id="bsp-results" data-mode="single-center"></div></div>
      <div id="rhs" style="width: 368px"><div>panel</div></div>
    </div>
  `);
  alignSingleCenter(document.getElementById("bsp-results"), 1400);
  const metrics = layoutMetrics(document, "single-center", 1400);
  assert.equal(document.getElementById("center_col").style.maxWidth, `${metrics.mainWidth}px`);
  assert.equal(document.getElementById("rhs").style.width, "360px");
  assert.equal(document.getElementById("rcnt").style.display, "flex");
  assert.equal(document.getElementById("rcnt").style.width, `${metrics.shellWidth}px`);
  assert.equal(document.getElementById("searchform").style.width, `${metrics.shellWidth}px`);
});

test("双列两卡等宽并整体按视口居中，搜索框同步居中", () => {
  const { document } = parseHTML(`
    <div id="searchform"></div>
    <div id="appbar"></div>
    <div id="center_col"><div id="bsp-results" data-mode="double"></div></div>
  `);
  const box = document.getElementById("bsp-results");
  alignSingleCenter(box, 1200);
  const expected = contentWidth("double", 1200);
  const left = Math.max(24, Math.round((1200 - expected) / 2));
  assert.equal(document.getElementById("searchform").style.width, `${expected}px`);
  assert.equal(document.getElementById("searchform").dataset.bspCentered, "1");
  assert.equal(document.getElementById("searchform").style.marginLeft, "auto");
  assert.equal(document.getElementById("appbar").style.width, `${expected}px`);
  assert.equal(document.getElementById("center_col").style.width, `${expected}px`);
  assert.equal(document.getElementById("center_col").style.marginLeft, `${left}px`);
  assert.equal(box.style.gridTemplateColumns, "minmax(0, 1fr) minmax(0, 1fr)");
});

test("列模式结果条目使用卡片样式并放开内部宽度", () => {
  const css = readFileSync(new URL("../extension/content.css", import.meta.url), "utf8");
  assert.match(css, /#bsp-results\[data-mode="single-center"\] > \*:has\(h3\)[\s\S]*border-radius:\s*var\(--bsp-card-radius\)/);
  assert.match(css, /#bsp-results\[data-mode="double"\][\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /yuRUbf[\s\S]*max-width:\s*100%\s*!important/);
  assert.match(css, /padding:\s*var\(--bsp-card-pad-y\)\s+var\(--bsp-card-pad-x\)/);
});

test("清单只注入搜索结果页且不申请落地页权限", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const serialized = JSON.stringify(manifest);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts[0].matches.includes("https://www.baidu.com/s*"), true);
  assert.equal(manifest.content_scripts[0].matches.includes("https://www.google.com/search*"), true);
  assert.equal(manifest.content_scripts[0].js.includes("content.js"), true);
  assert.equal(serialized.includes("<all_urls>"), false);
});

test("只差大小写的高亮段仍用各自的底色", async () => {
  const { document } = parseHTML(baiduPage("Chrome chrome"));
  const { createSearchSession } = await import("../src/search-session.mjs");
  createSearchSession(document, "https://www.baidu.com/s?wd=Chrome%20chrome", {
    columnMode: "original",
    highlight: true,
    autoPage: false,
  });
  const marks = [...document.querySelectorAll("h3 mark.bsp-hl")];
  assert.equal(marks[0].dataset.bspSeg, "0");
  assert.equal(marks[1].dataset.bspSeg, "1");
  assert.notEqual(marks[0].style.backgroundColor, marks[1].style.backgroundColor);
});

test("高亮样式给不同段不同底色", () => {
  const css = readFileSync(new URL("../extension/content.css", import.meta.url), "utf8");
  assert.match(css, /data-bsp-seg="0"\][\s\S]*#fff3a0/);
  assert.match(css, /data-bsp-seg="1"\][\s\S]*#b8f2c8/);
  assert.notEqual(
    css.match(/data-bsp-seg="0"\] \{ background-color: ([^;]+);/)?.[1],
    css.match(/data-bsp-seg="1"\] \{ background-color: ([^;]+);/)?.[1],
  );
});

function baiduPage(query) {
  return `<!doctype html><html><body>
    <div id="head">
      <form id="form"><input id="kw" value="${query}"></form>
    </div>
    <div id="content_left">
      <div class="c-container">
        <h3><a href="https://example.com/a">${query} 下载</a></h3>
        <div class="c-abstract">这是 ${query} 的摘要</div>
      </div>
      <div class="c-container">
        <h3><a href="https://ad.example/x">广告 ${query}</a></h3>
        <span class="ec-tuiguang">广告</span>
      </div>
      <div id="rs"><a href="/s?wd=related">相关搜索 ${query}</a></div>
    </div>
    <div id="page"><a class="n" href="/s?wd=chrome&amp;pn=10">下一页</a></div>
  </body></html>`;
}
