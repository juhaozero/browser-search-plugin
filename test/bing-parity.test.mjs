import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createAutoPager } from "../src/auto-page.mjs";
import { alignSingleCenter, bootSearchPage, contentWidth, layoutMetrics } from "../src/content-boot.mjs";
import { searchPageKey } from "../src/content-lifecycle.mjs";
import { createSearchSession, isDesktopWebSearch, nextPageUrl } from "../src/search-session.mjs";
import { assertNoNode } from "./assert-dom.mjs";

const URL_Q = "https://www.bing.com/search?q=edge";

test("必应网页搜索默认单列居中，广告和分页留在原地", async () => {
  const { document } = parseHTML(bingPage());
  const boot = await bootSearchPage(document, URL_Q, { viewportWidth: 1200 }, { attachScroll: false, watchDom: false });
  assert.ok(boot?.session);
  assert.equal(boot.session.engine, "bing");
  const box = document.getElementById("bsp-results");
  assert.equal(box.dataset.mode, "single-center");
  assert.equal(box.querySelectorAll("li.b_algo").length, 2);
  assertNoNode(document.querySelector(".b_ad").closest("#bsp-results"));
  assert.equal(box.contains(document.querySelector(".b_pag")), false);
  assert.equal(document.documentElement.dataset.bspEngine, "bing");
  boot.dispose();
});

test("只认必应桌面网页搜索，图片/视频和首页不改", () => {
  assert.equal(isDesktopWebSearch(URL_Q), true);
  assert.equal(isDesktopWebSearch("https://cn.bing.com/search?q=edge"), true);
  assert.equal(isDesktopWebSearch("https://www.bing.com/"), false);
  assert.equal(isDesktopWebSearch("https://www.bing.com/search?q="), false);
  assert.equal(isDesktopWebSearch("https://www.bing.com/images/search?q=edge"), false);
  assert.equal(isDesktopWebSearch("https://www.bing.com/videos/search?q=edge"), false);
  assert.equal(isDesktopWebSearch("https://www.bing.com.evil.example/search?q=edge"), false);
});

test("同查询不同追踪参数视为同一必应搜索页", () => {
  assert.equal(
    searchPageKey("https://www.bing.com/search?q=edge&form=QBLH"),
    searchPageKey("https://www.bing.com/search?q=edge&FPIG=ABC&first=9"),
  );
  assert.notEqual(searchPageKey(URL_Q), searchPageKey("https://www.bing.com/search?q=chrome"));
});

test("必应下一页读页面上的分页链接（每页条数不固定），读不到才按 first 推算", () => {
  const { document } = parseHTML(bingPage());
  assert.equal(nextPageUrl(URL_Q, document), "https://www.bing.com/search?q=edge&first=9&FORM=PORE");
  assert.equal(nextPageUrl(URL_Q), "https://www.bing.com/search?q=edge&first=11");
  assert.equal(nextPageUrl("https://www.bing.com/search?q=edge&first=11"), "https://www.bing.com/search?q=edge&first=21");
});

test("必应跳转链接按真实地址去重：换了追踪参数的同一结果不再接第二次", () => {
  const { document } = parseHTML(bingPage());
  const session = createSearchSession(document, URL_Q, { columnMode: "single-center", autoPage: true });
  const dup = bingItem(ck("https://example.com/a", "other-tracking"), "重复的 a");
  const fresh = bingItem(ck("https://example.com/c"), "新的 c");
  const result = session.ingest(parseHTML(`<ol id="b_results">${dup}${fresh}</ol>`).document);
  assert.equal(result.added, 1);
  assert.equal(document.querySelectorAll("#bsp-results li.b_algo").length, 3);
});

test("必应自动翻页连续按每一页自己的分页链接往后取", async () => {
  const { document } = parseHTML(bingPage());
  const session = createSearchSession(document, URL_Q, { columnMode: "single-center", autoPage: true });
  const requested = [];
  const pager = createAutoPager({
    document,
    session,
    url: URL_Q,
    fetchDocument: async (url) => {
      requested.push(url);
      const n = requested.length;
      return parseHTML(`<ol id="b_results">
        ${bingItem(ck(`https://example.com/p${n}`), `第${n}页`)}
        <li class="b_pag"><a class="sb_pagN" href="/search?q=edge&amp;first=${9 + n * 10}&amp;FORM=PORE">下一页</a></li>
      </ol>`).document;
    },
  });
  const near = { scrollY: 0, viewportHeight: 800, listBottom: 900 };
  assert.equal((await pager.check(near)).fetched, true);
  assert.equal((await pager.check(near)).fetched, true);
  assert.deepEqual(requested, [
    "https://www.bing.com/search?q=edge&first=9&FORM=PORE",
    "https://www.bing.com/search?q=edge&first=19&FORM=PORE",
  ]);
  assert.ok(document.querySelector("#bsp-results a[href*='u=a1']"));
  pager.dispose();
  session.dispose();
});

test("必应顶栏、导航、通栏答案、结果列共用同一居中壳（右栏已屏蔽）", () => {
  for (const mode of ["single-center", "double"]) {
    const { document } = parseHTML(bingPage({ mode }));
    const metrics = layoutMetrics(document, mode, 1400);
    // 必应右栏由 CSS 隐藏，不参与布局；hasAside 始终 false
    assert.equal(metrics.hasAside, false);
    alignSingleCenter(document.getElementById("bsp-results"), 1400);
    const expected = metrics.shellWidth;
    const left = metrics.targetLeft;

    const header = document.getElementById("b_header");
    assert.equal(header.style.width, `${expected}px`);
    assert.equal(header.style.marginLeft, `${left}px`);
    assert.notEqual(header.style.display, "flex", "顶栏不能被当成导航改成单行 flex");
    // b_tween 只对齐左缘，不改 position / width（避免图标相对定位错位）
    assert.equal(document.getElementById("b_tween").style.marginLeft, `${left}px`);
    // width 不再由 JS 设置，保留原生值（空字符串 or 原生值）

    // 右栏屏蔽后壳宽 = 主列宽，外壳退化成普通块（无需 flex 并排）
    const shell = document.getElementById("b_mcw");
    assert.equal(shell.style.width, `${expected}px`);
    assert.equal(shell.style.marginLeft, `${left}px`);
    assert.equal(document.getElementById("b_content").style.paddingLeft, "0");

    const results = document.getElementById("b_results");
    // 无右栏：结果列限宽即等于壳宽
    assert.ok(results.style.maxWidth === `${metrics.mainWidth}px` || results.style.maxWidth === `${expected}px`);

    const nav = document.querySelector("nav.b_scopebar");
    const row = nav.querySelector("ul");
    assert.equal(nav.style.justifyContent, "center");
    assert.equal(nav.style.width, "100%");
    assert.equal(row.style.width, "max-content");
    assert.equal(row.style.overflowX, "visible");
    // 标签间距（li margin）属于标签本身，不当成偏移清掉
    assert.equal(nav.querySelector("li + li").style.marginLeft, "12px");
    assert.equal(nav.querySelector("li > a").style.paddingLeft, "");
  }
});

test("必应无右栏时仍整体落位外壳，普通单列不改导航", () => {
  const { document } = parseHTML(bingPage({ mode: "single-center", aside: false }));
  alignSingleCenter(document.getElementById("bsp-results"), 1400);
  const expected = contentWidth("single-center", 1400);
  const shell = document.getElementById("b_mcw");
  assert.equal(shell.style.width, `${expected}px`);
  assert.equal(document.getElementById("b_results").style.maxWidth, `${expected}px`);

  const plain = parseHTML(bingPage({ mode: "single" })).document;
  alignSingleCenter(plain.getElementById("bsp-results"), 1400);
  assert.equal(plain.querySelector("nav.b_scopebar").dataset.bspCentered, undefined);
  assert.equal(plain.getElementById("b_mcw").style.width, "");
});

test("新版必应以 #b_content 为壳，右栏屏蔽后 main 独占壳宽", () => {
  for (const mode of ["single-center", "double"]) {
    const { document } = parseHTML(bingContentPage({ mode }));
    const metrics = layoutMetrics(document, mode, 1400);
    // 必应右栏被屏蔽，不参与布局
    assert.equal(metrics.hasAside, false);
    alignSingleCenter(document.getElementById("bsp-results"), 1400);
    const shell = document.getElementById("b_content");
    assert.equal(shell.style.width, `${metrics.shellWidth}px`);
    assert.equal(shell.style.marginLeft, `${metrics.targetLeft}px`);
    const main = document.querySelector("#b_content > main");
    assert.equal(main.style.display, "block");
    // main 直接限宽，不再是 flex 子项
    assert.ok(
      main.style.maxWidth === `${metrics.mainWidth}px` || main.style.width === `${metrics.mainWidth}px`,
      `main 宽度应等于 mainWidth=${metrics.mainWidth}`,
    );
  }
});

test("清单匹配必应搜索路径，卡片样式覆盖必应结果", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const matches = manifest.content_scripts[0].matches;
  assert.equal(matches.includes("https://www.bing.com/search*"), true);
  assert.equal(matches.includes("https://cn.bing.com/search*"), true);
  const css = readFileSync(new URL("../extension/content.css", import.meta.url), "utf8");
  assert.match(css, /#bsp-results\[data-mode="double"\] > li\.b_algo[\s\S]*border-radius:\s*var\(--bsp-card-radius\)/);
  assert.match(css, /:not\(:has\(h3\)\):not\(\.b_algo\)/);
  assert.match(css, /\.b_tranthis[\s\S]*display:\s*none/);
  assert.match(css, /\.b_vlist2col[\s\S]*float:\s*none/);
  assert.match(css, /data-bsp-results-host/);
});

test("必应结果盒挂在 ol 的 li 宿主上，避免非法 div 子节点", async () => {
  const { document } = parseHTML(bingPage());
  const boot = await bootSearchPage(document, URL_Q, { viewportWidth: 1200 }, { attachScroll: false, watchDom: false });
  const box = document.getElementById("bsp-results");
  const host = box.parentElement;
  assert.equal(host?.tagName, "LI");
  assert.equal(host?.getAttribute("data-bsp-results-host"), "1");
  assert.equal(host?.parentElement?.id, "b_results");
  assert.equal(box.querySelectorAll(":scope > li.b_algo").length, 2);
  boot.dispose();
  assert.equal(document.querySelector("[data-bsp-results-host]"), null);
  assert.equal(document.getElementById("bsp-results"), null);
});

function ck(target, tracking = "tracking") {
  const encoded = `a1${Buffer.from(target).toString("base64url")}`;
  return `https://www.bing.com/ck/a?!&amp;&amp;p=${tracking}&amp;ptn=3&amp;u=${encoded}&amp;ntb=1`;
}

function bingItem(href, title) {
  return `<li class="b_algo"><h2><a href="${href}">${title}</a></h2><div class="b_caption"><p>${title} 摘要</p></div></li>`;
}

function bingPage({ mode, aside = true } = {}) {
  const box = mode ? `<div id="bsp-results" data-mode="${mode}"></div>` : "";
  return `<!doctype html><html><body>
    <header id="b_header">
      <form id="sb_form"><a class="b_logoArea"></a><input id="sb_form_q" name="q" value="edge"></form>
      <div id="id_h" style="float:right">账号</div>
      <nav class="b_scopebar" role="navigation"><ul>
        <li id="b-scopeListItem-web" class="b_active"><a href="/search?q=edge">全部</a></li>
        <li id="b-scopeListItem-images" style="margin-left:12px"><a href="/images/search?q=edge">图片</a></li>
        <li id="b-scopeListItem-video" style="margin-left:12px"><a href="/videos/search?q=edge">视频</a></li>
        <li id="b-scopeListItem-menu" style="margin-left:12px"><a href="#">更多</a>
          <div class="b_sp_over_cont"><ul class="b_sp_over_menu"><li><a href="/shop?q=edge">购物</a></li></ul></div>
        </li>
      </ul></nav>
    </header>
    <div id="b_content" style="padding-left:18px"><main>
      <div id="b_tween">约 1,000 个结果</div>
      <div id="b_mcw">
        <ol id="b_topw"><li class="b_ans">通栏答案</li></ol>
        <ol id="b_results">
          ${box}
          <li class="b_ad"><ul><li><h2><a href="https://ad.example/x">广告</a></h2><div class="b_adSlug">广告</div></li></ul></li>
          ${bingItem(ck("https://example.com/a"), "edge 扩展 a")}
          ${bingItem(ck("https://example.com/b"), "edge 扩展 b")}
          <li class="b_pag"><a class="sb_pagN" href="/search?q=edge&amp;first=9&amp;FORM=PORE">下一页</a></li>
        </ol>
        ${aside ? `<aside><ol id="b_context" style="margin-left:20px;padding-left:20px"><li>知识卡</li></ol></aside>` : ""}
      </div>
    </main></div>
  </body></html>`;
}

function bingContentPage({ mode } = {}) {
  const box = mode ? `<div id="bsp-results" data-mode="${mode}"></div>` : "";
  return `<!doctype html><html><body>
    <header id="b_header">
      <form id="sb_form"><input id="sb_form_q" name="q" value="edge"></form>
      <nav class="b_scopebar" role="navigation"><ul>
        <li><a href="/search?q=edge">全部</a></li>
        <li style="margin-left:12px"><a href="/images/search?q=edge">图片</a></li>
      </ul></nav>
    </header>
    <div id="b_content">
      <main>
        <div id="b_tween">约 1,000 个结果</div>
        <ol id="b_results">
          ${box}
          ${bingItem(ck("https://example.com/a"), "edge 扩展 a")}
          ${bingItem(ck("https://example.com/b"), "edge 扩展 b")}
        </ol>
      </main>
      <aside style="width:320px"><div>深入了解</div></aside>
    </div>
  </body></html>`;
}
