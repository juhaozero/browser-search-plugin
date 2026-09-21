import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { alignSingleCenter, bootBaiduPage } from "../src/content-baidu.mjs";

test("百度网页搜索默认单列居中并给不同高亮段不同标记", () => {
  const { document } = parseHTML(baiduPage("chrome 扩展"));
  const boot = bootBaiduPage(document, "https://www.baidu.com/s?wd=chrome%20%E6%89%A9%E5%B1%95", {
    viewportWidth: 1200,
    parentLeft: 80,
  }, { attachScroll: false });
  assert.ok(boot?.session);
  const box = document.getElementById("bsp-results");
  assert.equal(box.dataset.mode, "single-center");
  assert.equal(box.style.width, "680px");
  assert.equal(box.style.marginLeft, "180px");
  const marks = [...document.querySelectorAll("h3 mark.bsp-hl")];
  assert.equal(marks[0].dataset.bspSeg, "0");
  assert.equal(marks[1].dataset.bspSeg, "1");
  assert.notEqual(marks[0].style.backgroundColor, marks[1].style.backgroundColor);
  assert.equal(document.querySelector("#kw mark"), null);
  assert.equal(document.querySelector("#rs mark"), null);
  assert.equal(document.querySelector(".ec-tuiguang").closest(".c-container").querySelector("mark"), null);
  assert.equal(document.getElementById("page").textContent, "下一页");
  assert.equal(box.contains(document.getElementById("rs")), false);
  assert.deepEqual([...document.querySelectorAll("[id^='bsp-']")].map((element) => element.id), ["bsp-results"]);
});

test("首页、手机版和资讯页不改页面", () => {
  for (const url of [
    "https://www.baidu.com/",
    "https://m.baidu.com/s?wd=chrome",
    "https://www.baidu.com/s?wd=chrome&tn=news",
  ]) {
    const { document } = parseHTML(baiduPage("chrome"));
    assert.equal(bootBaiduPage(document, url), null);
    assert.equal(document.getElementById("bsp-results"), null);
    assert.equal(document.querySelector("mark"), null);
  }
});

test("单列居中按视口把结果列放到页面中间", () => {
  const { document } = parseHTML(`<div id="bsp-results" data-mode="single-center"></div>`);
  const box = document.getElementById("bsp-results");
  alignSingleCenter(box, 1000, 100);
  assert.equal(box.style.width, "680px");
  assert.equal(box.style.marginLeft, "60px");
  alignSingleCenter(box, 400, 0);
  assert.equal(box.style.width, "368px");
});

test("清单只注入百度且不申请落地页权限", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const serialized = JSON.stringify(manifest);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.baidu.com/s*"]);
  assert.equal(manifest.content_scripts[0].js.includes("content.js"), true);
  assert.equal(serialized.includes("<all_urls>"), false);
  assert.equal(serialized.includes("google.com"), false);
});

test("只差大小写的高亮段仍用各自的底色", () => {
  const { document } = parseHTML(baiduPage("Chrome chrome"));
  bootBaiduPage(document, "https://www.baidu.com/s?wd=Chrome%20chrome");
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
    <input id="kw" value="${query}">
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
