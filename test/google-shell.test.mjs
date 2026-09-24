import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { alignSingleCenter, bootSearchPage, contentWidth, layoutMetrics } from "../src/content-boot.mjs";

test("单列居中按视口把结果列放到页面中间", () => {
  const { document } = parseHTML(`
    <form id="form"></form>
    <div id="center_col"><div id="bsp-results" data-mode="single-center"></div></div>
  `);
  const box = document.getElementById("bsp-results");
  alignSingleCenter(box, 1000);
  const expected = contentWidth("single-center", 1000);
  const left = Math.max(32, Math.round((1000 - expected) / 2));
  assert.equal(document.getElementById("center_col").style.width, `${expected}px`);
  assert.equal(document.getElementById("center_col").style.marginLeft, `${left}px`);
  assert.equal(box.style.width, "100%");
  alignSingleCenter(box, 400);
  assert.equal(document.getElementById("center_col").style.width, `${contentWidth("single-center", 400)}px`);
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
  const left = Math.max(32, Math.round((1200 - expected) / 2));
  const form = document.getElementById("searchform");
  assert.equal(form.style.width, `${expected}px`);
  assert.equal(form.dataset.bspCentered, "1");
  assert.equal(form.style.marginLeft, `${left}px`);
  assert.equal(form.style.marginRight, "auto");
  assert.equal(form.style.left, "auto");
  assert.equal(document.getElementById("appbar").style.width, `${expected}px`);
  assert.equal(document.getElementById("appbar").style.marginLeft, `${left}px`);
  assert.equal(document.getElementById("center_col").style.width, `${expected}px`);
  assert.equal(document.getElementById("center_col").style.marginLeft, `${left}px`);
  // 不改写壳内 #tsf，避免清空查询词
  assert.equal(document.getElementById("tsf").style.width, "");
});

test("壳宽未变时仍刷新搜索栏到单列居中壳宽，避免全宽居左", () => {
  const { document } = parseHTML(`
    <div id="searchform"><form id="tsf"></form></div>
    <div id="center_col"><div id="bsp-results" data-mode="single-center"></div></div>
  `);
  const box = document.getElementById("bsp-results");
  alignSingleCenter(box, 1400);
  const expected = contentWidth("single-center", 1400);
  const left = Math.max(32, Math.round((1400 - expected) / 2));
  const form = document.getElementById("searchform");
  // 模拟谷歌把搜索栏改回全宽居左
  form.style.setProperty("width", "100%");
  form.style.setProperty("margin-left", "0");
  form.style.setProperty("left", "12px");
  alignSingleCenter(box, 1400);
  assert.equal(form.style.width, `${expected}px`);
  assert.equal(form.style.marginLeft, `${left}px`);
  assert.equal(form.style.left, "auto");
  assert.equal(document.getElementById("tsf").style.width, "");
});

test("晚到的搜索栏也会按单列居中壳宽落位并居中", () => {
  const { document } = parseHTML(`
    <div id="center_col"><div id="bsp-results" data-mode="single-center"></div></div>
  `);
  const box = document.getElementById("bsp-results");
  alignSingleCenter(box, 1400);
  const expected = contentWidth("single-center", 1400);
  const left = Math.max(32, Math.round((1400 - expected) / 2));

  const form = document.createElement("div");
  form.id = "searchform";
  const inner = document.createElement("form");
  inner.id = "tsf";
  form.appendChild(inner);
  const col = document.getElementById("center_col");
  col.parentNode.insertBefore(form, col);

  alignSingleCenter(box, 1400);
  assert.equal(form.dataset.bspCentered, "1");
  assert.equal(form.style.width, `${expected}px`);
  assert.equal(form.style.marginLeft, `${left}px`);
  assert.equal(inner.style.width, "");
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
  assert.equal(document.getElementById("searchform").style.marginLeft, `${metrics.targetLeft}px`);
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
  const left = Math.max(32, Math.round((1200 - expected) / 2));
  assert.equal(document.getElementById("searchform").style.width, `${expected}px`);
  assert.equal(document.getElementById("searchform").dataset.bspCentered, "1");
  assert.equal(document.getElementById("searchform").style.marginLeft, `${left}px`);
  assert.equal(document.getElementById("appbar").style.width, `${expected}px`);
  assert.equal(document.getElementById("center_col").style.width, `${expected}px`);
  assert.equal(document.getElementById("center_col").style.marginLeft, `${left}px`);
  assert.equal(box.style.gridTemplateColumns, "minmax(0, 1fr) minmax(0, 1fr)");
});

test("单列/双列壳宽与顶栏共用同一视口中线", () => {
  for (const mode of ["single-center", "double"]) {
    const { document } = parseHTML(`
      <div id="searchform"></div>
      <div id="center_col"><div id="bsp-results" data-mode="${mode}"></div></div>
    `);
    alignSingleCenter(document.getElementById("bsp-results"), 1600);
    const expected = contentWidth(mode, 1600);
    const left = Math.max(32, Math.round((1600 - expected) / 2));
    assert.equal(document.getElementById("searchform").style.marginLeft, `${left}px`);
    assert.equal(document.getElementById("center_col").style.marginLeft, `${left}px`);
    assert.equal(document.getElementById("searchform").style.width, `${expected}px`);
    assert.equal(document.getElementById("center_col").style.width, `${expected}px`);
  }
});

test("普通单列不改导航条，保持引擎原生位置", () => {
  const { document } = parseHTML(`
    <div id="s_tab" class="s_tab">
      <div id="s_tab_inner" class="s_tab_inner">
        <a href="#">全部</a><a href="#">图片</a>
      </div>
    </div>
    <div id="center_col"><div id="bsp-results" data-mode="single"></div></div>
  `);
  alignSingleCenter(document.getElementById("bsp-results"), 1400);
  const tab = document.getElementById("s_tab");
  assert.equal(tab.dataset.bspCentered, undefined);
  assert.equal(tab.style.justifyContent, "");
  assert.equal(tab.style.width, "");
  assert.equal(tab.style.marginLeft, "");
});

test("谷歌式空 spacer + 标签行：导航不被收成 0 宽且与搜索栏同壳", () => {
  const { document } = parseHTML(`
    <div id="searchform"></div>
    <div id="appbar">
      <div id="nav-band">
        <div class="spacer" style="width:180px"></div>
        <div class="tabs">
          <a jsname="pxBnId" href="#">全部</a>
          <a jsname="pxBnId" href="#">图片</a>
          <a jsname="pxBnId" href="#">新闻</a>
          <a jsname="pxBnId" href="#">视频</a>
        </div>
      </div>
    </div>
    <div id="center_col"><div id="bsp-results" data-mode="double"></div></div>
  `);
  for (const a of document.querySelectorAll("a[jsname='pxBnId']")) {
    a.getBoundingClientRect = () => ({ left: 0, top: 0, right: 40, bottom: 24, width: 40, height: 24 });
  }
  const band = document.getElementById("nav-band");
  band.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 40, width: 800, height: 40 });
  alignSingleCenter(document.getElementById("bsp-results"), 1400);
  const search = document.getElementById("searchform");
  const expected = contentWidth("double", 1400);
  const left = Math.max(32, Math.round((1400 - expected) / 2));
  assert.equal(search.style.width, `${expected}px`);
  assert.equal(search.style.marginLeft, `${left}px`);
  // 导航在 appbar 内：拉满宿主，与搜索栏左右缘一致
  assert.equal(band.style.width, "100%");
  assert.ok(band.style.marginLeft === "0" || band.style.marginLeft === "0px");
  const tabs = document.querySelector(".tabs");
  const spacer = document.querySelector(".spacer");
  assert.equal(tabs.style.width, "max-content");
  assert.equal(tabs.style.justifyContent, "center");
  assert.equal(tabs.style.overflow, "visible");
  assert.ok(!tabs.style.transform || tabs.style.transform === "none");
  assert.equal(tabs.dataset.bspNavScrollkill, "1");
  assert.equal(band.dataset.bspNavScrollkill, "1");
  assert.equal(band.style.overflowX, "visible");
  assert.equal(band.style.justifyContent, "center");
  assert.equal(spacer.dataset.bspNavSpacer, "1");
  assert.equal(spacer.style.display, "none");
  assert.equal(tabs.dataset.bspNavSpacer, undefined);
  assert.equal(document.getElementById("appbar").style.width, `${expected}px`);
  assert.equal(document.getElementById("appbar").style.marginLeft, `${left}px`);
  assert.equal(document.getElementById("appbar").style.justifyContent, "center");
});

test("壳宽未变时晚到的导航仍会刷新居中", () => {
  const { document } = parseHTML(`
    <div id="searchform"></div>
    <div id="center_col"><div id="bsp-results" data-mode="single-center"></div></div>
  `);
  const box = document.getElementById("bsp-results");
  alignSingleCenter(box, 1400);
  const expected = contentWidth("single-center", 1400);
  const left = Math.max(32, Math.round((1400 - expected) / 2));

  // 模拟谷歌导航晚到
  const appbar = document.createElement("div");
  appbar.id = "appbar";
  const pad = document.createElement("div");
  pad.style.paddingLeft = "180px";
  const tabs = document.createElement("div");
  tabs.className = "tabs";
  for (const label of ["全部", "图片", "新闻", "视频"]) {
    const a = document.createElement("a");
    a.setAttribute("jsname", "pxBnId");
    a.href = "#";
    a.textContent = label;
    a.getBoundingClientRect = () => ({ left: 200, top: 0, right: 240, bottom: 24, width: 40, height: 24 });
    tabs.appendChild(a);
  }
  // 标签行整体偏右：中线在 400，搜索栏中线应在 left + expected/2
  tabs.getBoundingClientRect = () => ({ left: 280, top: 0, right: 520, bottom: 24, width: 240, height: 24 });
  pad.appendChild(tabs);
  appbar.appendChild(pad);
  document.body.insertBefore(appbar, document.getElementById("center_col"));

  document.getElementById("searchform").getBoundingClientRect = () => ({
    left,
    top: 0,
    right: left + expected,
    bottom: 48,
    width: expected,
    height: 48,
  });

  // 壳宽未变：走 refreshChromeLayout，导航应壳内居中且无横向滚动
  alignSingleCenter(box, 1400);
  assert.equal(document.documentElement.dataset.bspShellWidth, String(expected));
  assert.equal(document.getElementById("appbar").style.width, `${expected}px`);
  assert.equal(document.getElementById("appbar").style.marginLeft, `${left}px`);
  assert.equal(document.getElementById("appbar").style.justifyContent, "center");
  assert.equal(tabs.style.width, "max-content");
  assert.equal(tabs.style.justifyContent, "center");
  assert.ok(!tabs.style.transform || tabs.style.transform === "none");
  assert.equal(tabs.style.overflow, "visible");
  assert.equal(tabs.dataset.bspNavScrollkill, "1");
  assert.equal(pad.style.display, "flex");
  assert.equal(pad.style.justifyContent, "center");
  assert.equal(pad.style.paddingLeft, "0");
  assert.equal(pad.style.overflowX, "visible");
  // 中间 pad 可拉满宿主；已定壳宽的 #appbar 自身不能被改成 100%
  assert.equal(pad.style.width, "100%");
  assert.notEqual(document.getElementById("appbar").style.width, "100%");
});

test("谷歌多层左缩进包装：标签行仍在壳正中", () => {
  const { document } = parseHTML(`
    <div id="searchform"></div>
    <div id="appbar">
      <div id="outer" style="padding-left:180px;margin-left:40px">
        <div id="mid" style="padding-left:120px">
          <div class="spacer" aria-hidden="true" style="width:80px"></div>
          <div class="tabs">
            <a jsname="pxBnId" href="#">全部</a>
            <a jsname="pxBnId" href="#">图片</a>
            <a jsname="pxBnId" href="#">新闻</a>
            <a jsname="pxBnId" href="#">视频</a>
            <a jsname="pxBnId" href="#">短视频</a>
          </div>
        </div>
      </div>
    </div>
    <div id="center_col"><div id="bsp-results" data-mode="single-center"></div></div>
  `);
  for (const a of document.querySelectorAll("a[jsname='pxBnId']")) {
    a.getBoundingClientRect = () => ({ left: 0, top: 0, right: 40, bottom: 24, width: 40, height: 24 });
  }
  alignSingleCenter(document.getElementById("bsp-results"), 1400);
  const expected = contentWidth("single-center", 1400);
  const left = Math.max(32, Math.round((1400 - expected) / 2));
  const appbar = document.getElementById("appbar");
  const outer = document.getElementById("outer");
  const mid = document.getElementById("mid");
  const tabs = document.querySelector(".tabs");
  const spacer = document.querySelector(".spacer");

  assert.equal(appbar.style.width, `${expected}px`);
  assert.equal(appbar.style.marginLeft, `${left}px`);
  assert.equal(appbar.style.justifyContent, "center");
  assert.equal(outer.style.paddingLeft, "0");
  assert.equal(outer.style.marginLeft, "0");
  assert.equal(outer.style.width, "100%");
  assert.equal(outer.style.justifyContent, "center");
  assert.equal(mid.style.paddingLeft, "0");
  assert.equal(mid.style.justifyContent, "center");
  assert.equal(tabs.style.width, "max-content");
  assert.equal(spacer.style.display, "none");
});

test("谷歌非空左侧 gutter 也会被压缩，芯片落在壳正中", () => {
  const { document } = parseHTML(`
    <div id="searchform"></div>
    <div id="appbar">
      <div id="row">
        <div id="gutter" style="width:280px;flex:0 0 280px"><svg></svg><span> </span></div>
        <div class="tabs" style="overflow-x:auto">
          <a jsname="pxBnId" href="#">全部</a>
          <a jsname="pxBnId" href="#">图片</a>
          <a jsname="pxBnId" href="#">新闻</a>
          <a jsname="pxBnId" href="#">视频</a>
        </div>
      </div>
    </div>
    <div id="center_col"><div id="bsp-results" data-mode="double"></div></div>
  `);
  for (const a of document.querySelectorAll("a[jsname='pxBnId']")) {
    a.getBoundingClientRect = () => ({ left: 400, top: 0, right: 440, bottom: 24, width: 40, height: 24 });
  }
  const appbar = document.getElementById("appbar");
  appbar.getBoundingClientRect = () => ({ left: 40, top: 0, right: 1360, bottom: 48, width: 1320, height: 48 });
  alignSingleCenter(document.getElementById("bsp-results"), 1400);
  const expected = contentWidth("double", 1400);
  const gutter = document.getElementById("gutter");
  const tabs = document.querySelector(".tabs");
  assert.equal(appbar.style.width, `${expected}px`);
  assert.equal(appbar.style.justifyContent, "center");
  assert.equal(gutter.dataset.bspNavSpacer, "1");
  assert.equal(gutter.style.display, "none");
  assert.equal(tabs.style.width, "max-content");
  assert.equal(tabs.style.overflowX, "visible");
  assert.equal(tabs.dataset.bspNavScrollkill, "1");
});

test("标签行后面的「工具」贴到右端，不参与居中也不和标签重叠", () => {
  const { document } = parseHTML(`
    <div id="searchform"></div>
    <div id="appbar">
      <div id="row">
        <div class="tabs">
          <a jsname="pxBnId" href="#">全部</a>
          <a jsname="pxBnId" href="#">图片</a>
          <a jsname="pxBnId" href="#">新闻</a>
        </div>
        <div id="tools"><div role="button">工具</div></div>
      </div>
    </div>
    <div id="center_col"><div id="bsp-results" data-mode="single-center"></div></div>
  `);
  alignSingleCenter(document.getElementById("bsp-results"), 1400);
  const row = document.getElementById("row");
  const tools = document.getElementById("tools");
  const tabs = document.querySelector(".tabs");
  assert.equal(tools.dataset.bspNavTrailing, "1");
  assert.equal(tools.style.position, "absolute");
  assert.equal(tools.style.right, "0");
  assert.notEqual(tools.style.display, "none");
  assert.equal(row.style.position, "relative");
  assert.equal(row.style.justifyContent, "center");
  // 标签行不再做 left 位移
  assert.ok(!tabs.style.left || tabs.style.left === "0" || tabs.style.left === "0px");
});

test("列模式结果条目使用卡片样式并放开内部宽度", () => {
  const css = readFileSync(new URL("../extension/content.css", import.meta.url), "utf8");
  assert.match(css, /#bsp-results\[data-mode="single-center"\] > \*:has\(h3\)[\s\S]*border-radius:\s*var\(--bsp-card-radius\)/);
  assert.match(css, /#bsp-results\[data-mode="double"\][\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /yuRUbf[\s\S]*max-width:\s*100%\s*!important/);
  assert.match(css, /padding:\s*var\(--bsp-card-pad-y\)\s+var\(--bsp-card-pad-x\)/);
  assert.match(css, /nav\.b_scopebar\[data-bsp-centered\][\s\S]*justify-content:\s*center/);
});

test("清单只注入搜索结果页且不申请落地页权限", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const serialized = JSON.stringify(manifest);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts[0].matches.includes("https://www.google.com/search*"), true);
  assert.equal(manifest.content_scripts[0].js.includes("content.js"), true);
  assert.equal(serialized.includes("<all_urls>"), false);
});
