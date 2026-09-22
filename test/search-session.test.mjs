import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import {
  createSearchSession,
  highlightSegments,
  isDesktopWebSearch,
  nextPageUrl,
  siteSearchHref,
} from "../src/search-session.mjs";

test("只认桌面版网页搜索", () => {
  assert.equal(isDesktopWebSearch("https://www.baidu.com/s?wd=chrome"), true);
  assert.equal(isDesktopWebSearch("https://www.google.com/search?q=chrome"), true);
  assert.equal(isDesktopWebSearch("https://www.google.com.hk/search?q=chrome"), true);
  assert.equal(isDesktopWebSearch("https://m.baidu.com/s?wd=chrome"), false);
  assert.equal(isDesktopWebSearch("https://www.google.com/search?q=chrome&tbm=isch"), false);
  assert.equal(isDesktopWebSearch("https://www.google.com/search?q=chrome&udm=2"), false);
  assert.equal(isDesktopWebSearch("https://www.google.com/search?q=chrome&udm=14"), true);
  assert.equal(isDesktopWebSearch("https://www.baidu.com/s?wd=chrome&tn=news"), false);
  assert.equal(isDesktopWebSearch("https://www.baidu.com/"), false);
});

test("查询按空格和标点拆成高亮段，连续中文不拆", () => {
  assert.deepEqual(highlightSegments("chrome 扩展"), ["chrome", "扩展"]);
  assert.deepEqual(highlightSegments("浏览器扩展"), ["浏览器扩展"]);
  assert.deepEqual(highlightSegments("chrome，扩展。下载"), ["chrome", "扩展", "下载"]);
});

test("下一页地址从当前页往后推一页", () => {
  assert.equal(
    nextPageUrl("https://www.baidu.com/s?wd=chrome"),
    "https://www.baidu.com/s?wd=chrome&pn=10",
  );
  assert.equal(
    nextPageUrl("https://www.google.com/search?q=chrome&start=10"),
    "https://www.google.com/search?q=chrome&start=20",
  );
  assert.equal(nextPageUrl("https://m.baidu.com/s?wd=chrome"), null);
  assert.equal(nextPageUrl("https://www.baidu.com/"), null);
  assert.equal(nextPageUrl("https://www.baidu.com/s?wd=chrome&tn=news"), null);
  assert.equal(nextPageUrl("https://www.google.com/search?q=chrome&tbm=isch"), null);
  assert.equal(nextPageUrl("https://www.google.com/search?q=chrome&udm=2"), null);
});

test("结果条目可补站内其它相关信息链接，已有原生站内链接则不重复", () => {
  assert.equal(
    siteSearchHref("google", "https://www.google.com/search?q=cloudflare", "cloudflare.com"),
    "https://www.google.com/search?q=cloudflare%20site%3Acloudflare.com",
  );
  assert.equal(
    siteSearchHref("baidu", "https://www.baidu.com/s?wd=cloudflare", "cloudflare.com"),
    "https://www.baidu.com/s?wd=cloudflare%20site%3Acloudflare.com",
  );

  const { document } = parseHTML(baiduPage("cloudflare"));
  createSearchSession(document, "https://www.baidu.com/s?wd=cloudflare", {
    columnMode: "single-center",
    highlight: false,
    autoPage: false,
  });
  const link = document.querySelector("a.bsp-site-search");
  assert.ok(link);
  assert.match(link.textContent, /example\.com站内的其它相关信息/);
  assert.match(link.getAttribute("href") ?? "", /site%3Aexample\.com/);

  const { document: again } = parseHTML(`<!doctype html><html><body>
    <div id="content_left">
      <div class="c-container">
        <h3><a href="https://cloudflare.com/">Cloudflare</a></h3>
        <div class="c-abstract">摘要</div>
        <a href="https://www.baidu.com/s?wd=x%20site%3Acloudflare.com">cloudflare.com站内的其它相关信息 »</a>
      </div>
    </div>
  </body></html>`);
  createSearchSession(again, "https://www.baidu.com/s?wd=cloudflare", {
    columnMode: "original",
    highlight: false,
    autoPage: false,
  });
  assert.equal(again.querySelectorAll(".bsp-site-search-wrap").length, 0);
});

test("高亮只出现在结果条目的标题和摘要上", () => {
  const { document } = parseHTML(baiduPage("chrome 扩展"));
  createSearchSession(document, "https://www.baidu.com/s?wd=chrome%20%E6%89%A9%E5%B1%95", {
    columnMode: "original",
    highlight: true,
    autoPage: true,
  });

  const organic = document.querySelector("h3 a[href='https://example.com/a']");
  assert.ok(organic.querySelector("mark.bsp-hl"));
  assert.match(document.querySelector(".c-abstract").textContent, /扩展/);
  assert.ok(document.querySelector(".c-abstract mark.bsp-hl"));
  assert.equal(document.querySelector("#kw mark"), null);
  assert.equal(document.querySelector("#rs mark"), null);
  assert.equal(document.querySelector(".ec-tuiguang").closest(".c-container").querySelector("mark"), null);
});

test("双列只搬走结果条目，页码和相关搜索留在原地", () => {
  const { document } = parseHTML(baiduPage("chrome"));
  createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "double",
    highlight: false,
    autoPage: true,
  });

  const box = document.getElementById("bsp-results");
  assert.equal(box.dataset.mode, "double");
  assert.equal(box.querySelectorAll(".c-container").length, 1);
  assert.equal(box.contains(document.getElementById("rs")), false);
  assert.equal(document.getElementById("page").textContent, "下一页");
  assert.equal(document.querySelector(".ec-tuiguang").closest("#content_left") !== null, true);
});

test("原始模式不搬动结果条目", () => {
  const { document } = parseHTML(baiduPage("chrome"));
  createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "original",
    highlight: false,
    autoPage: false,
  });
  assert.equal(document.getElementById("bsp-results"), null);
  assert.ok(document.querySelector("#content_left .c-container h3 a"));
});

test("单列居中是单独的一种列模式", () => {
  const { document } = parseHTML(baiduPage("chrome"));
  createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "single-center",
    highlight: false,
    autoPage: false,
  });
  assert.equal(document.getElementById("bsp-results").dataset.mode, "single-center");
});

test("切回原始模式时本页结果条目回到原位，已接入的留在列表末尾并被高亮", () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "double",
    highlight: true,
    autoPage: true,
  });
  const next = parseHTML(resultPage("https://example.com/p1", "下一页 chrome")).document;
  assert.deepEqual(session.ingest(next), { added: 1, stopped: false });

  const appended = [...document.querySelectorAll("#bsp-results > .c-container")].find((item) =>
    item.querySelector("a[href='https://example.com/p1']"),
  );
  assert.ok(appended.querySelector("h3 mark.bsp-hl"));
  assert.ok(appended.querySelector(".c-abstract mark.bsp-hl"));

  session.apply({ columnMode: "original" });
  assert.equal(document.getElementById("bsp-results"), null);
  const left = document.getElementById("content_left");
  const original = left.querySelector("a[href='https://example.com/a']").closest(".c-container");
  assert.equal(original.parentElement, left);
  assert.ok(original.nextElementSibling.querySelector(".ec-tuiguang"));
  assert.equal(left.lastElementChild.querySelector("a").getAttribute("href"), "https://example.com/p1");
  assert.equal(left.contains(document.getElementById("rs")), true);
  assert.equal(document.getElementById("page").textContent, "下一页");
});

test("接上下一页时跳过已有链接，没有新结果就停，最多再接 10 页", () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "original",
    highlight: false,
    autoPage: true,
  });

  const duplicate = parseHTML(resultPage("https://example.com/a", "重复")).document;
  assert.deepEqual(session.ingest(duplicate), { added: 0, stopped: true });

  const { document: fresh } = parseHTML(baiduPage("chrome"));
  const again = createSearchSession(fresh, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "single",
    highlight: true,
    autoPage: true,
  });
  let last = { added: 0, stopped: false };
  for (let page = 1; page <= 11; page += 1) {
    const next = parseHTML(resultPage(`https://example.com/p${page}`, `第${page}页 chrome`)).document;
    last = again.ingest(next);
  }
  assert.equal(again.appendedPages, 10);
  assert.equal(last.stopped, true);
  assert.equal(fresh.querySelector("#page").textContent, "下一页");
  assert.equal(fresh.querySelectorAll("mark.bsp-hl").length > 0, true);
});

test("自动翻页关掉时不再接入下一页", () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "original",
    highlight: false,
    autoPage: false,
  });
  const next = parseHTML(resultPage("https://example.com/p1", "下一页 chrome")).document;
  assert.deepEqual(session.ingest(next), { added: 0, stopped: true });
  assert.equal(session.appendedPages, 0);
  assert.equal(document.querySelector("a[href='https://example.com/p1']"), null);
});

test("紧挨的多条结果从每种列模式切回原始模式时保持原顺序", () => {
  for (const columnMode of ["single", "single-center", "double"]) {
    const { document } = parseHTML(adjacentPage());
    const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
      columnMode,
      highlight: false,
      autoPage: true,
    });
    session.ingest(parseHTML(resultPage("https://example.com/p1", "下一页")).document);
    session.apply({ columnMode: "original" });
    const hrefs = [...document.querySelectorAll("#content_left > .c-container h3 a")].map((link) =>
      link.getAttribute("href"),
    );
    assert.deepEqual(hrefs, [
      "https://example.com/a",
      "https://example.com/b",
      "https://ad.example/x",
      "https://example.com/p1",
    ]);
  }
});

function adjacentPage() {
  return `<!doctype html><html><body><div id="content_left"><div class="c-container"><h3><a href="https://example.com/a">甲</a></h3></div><div class="c-container"><h3><a href="https://example.com/b">乙</a></h3></div><div class="c-container"><h3><a href="https://ad.example/x">广告</a></h3><span class="ec-tuiguang">广告</span></div></div><div id="page">下一页</div></body></html>`;
}

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

function resultPage(href, title) {
  return `<!doctype html><html><body><div id="content_left">
    <div class="c-container"><h3><a href="${href}">${title}</a></h3><div class="c-abstract">${title}</div></div>
  </div></body></html>`;
}
