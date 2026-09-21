import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createAutoPager, isNearBottom } from "../src/auto-page.mjs";
import { bootBaiduPage } from "../src/content-baidu.mjs";
import { createSearchSession } from "../src/search-session.mjs";

test("滚到结果列表底部附近会取下一页并沿用列模式与高亮", async () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "single-center",
    highlight: true,
    autoPage: true,
  });
  const fetches = [];
  const pager = createAutoPager({
    document,
    session,
    url: "https://www.baidu.com/s?wd=chrome",
    fetchDocument: async (url) => {
      fetches.push(url);
      return parseHTML(resultPage("https://example.com/p1", "第1页 chrome")).document;
    },
  });

  const result = await pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 900 });
  assert.equal(result.fetched, true);
  assert.equal(result.added, 1);
  assert.deepEqual(fetches, ["https://www.baidu.com/s?wd=chrome&pn=10"]);
  const box = document.getElementById("bsp-results");
  assert.equal(box.dataset.mode, "single-center");
  assert.ok(box.querySelector("a[href='https://example.com/p1']"));
  assert.ok(box.querySelector("h3 mark.bsp-hl"));
  assert.equal(document.getElementById("page").textContent, "下一页");
  assert.equal(document.getElementById("bsp-status").hidden, true);
});

test("取页过程中底部显示加载中", async () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "original",
    highlight: false,
    autoPage: true,
  });
  /** @type {(value: Document) => void} */
  let resolveFetch = () => {};
  const pager = createAutoPager({
    document,
    session,
    url: "https://www.baidu.com/s?wd=chrome",
    fetchDocument: () => new Promise((resolve) => {
      resolveFetch = resolve;
    }),
  });
  const pending = pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 850 });
  assert.equal(document.getElementById("bsp-status").textContent, "加载中");
  assert.equal(document.getElementById("bsp-status").hidden, false);
  resolveFetch(parseHTML(resultPage("https://example.com/p1", "第1页")).document);
  await pending;
  assert.equal(document.getElementById("bsp-status").hidden, true);
});

test("取页时显示加载中，失败时短暂显示加载失败且不自动连重试", async () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "original",
    highlight: false,
    autoPage: true,
  });
  let shouldFail = true;
  let calls = 0;
  /** @type {Array<() => void>} */
  const scheduled = [];
  const pager = createAutoPager({
    document,
    session,
    url: "https://www.baidu.com/s?wd=chrome",
    failTipMs: 2000,
    schedule: (fn) => {
      scheduled.push(fn);
      return scheduled.length;
    },
    fetchDocument: async () => {
      calls += 1;
      if (shouldFail) throw new Error("network");
      return parseHTML(resultPage("https://example.com/p1", "第1页")).document;
    },
  });

  const near = { scrollY: 0, viewportHeight: 800, listBottom: 850 };
  const failed = await pager.check(near);
  assert.equal(failed.failed, true);
  assert.equal(document.getElementById("bsp-status").textContent, "加载失败");
  assert.equal(document.getElementById("bsp-status").hidden, false);
  assert.equal(document.querySelector("a[href='https://example.com/p1']"), null);
  assert.equal(scheduled.length, 1);

  const again = await pager.check(near);
  assert.equal(again.fetched, false);
  assert.equal(calls, 1);

  await pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 2000 });
  shouldFail = false;
  const retried = await pager.check(near);
  assert.equal(retried.fetched, true);
  assert.equal(calls, 2);
  assert.ok(document.querySelector("a[href='https://example.com/p1']"));

  scheduled[0]();
  assert.equal(document.getElementById("bsp-status").hidden, true);
});

test("只关会话自动翻页时不再取页，也不会被当成没有更多页", async () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "original",
    highlight: false,
    autoPage: true,
  });
  let calls = 0;
  const pager = createAutoPager({
    document,
    session,
    url: "https://www.baidu.com/s?wd=chrome",
    enabled: true,
    fetchDocument: async () => {
      calls += 1;
      return parseHTML(resultPage("https://example.com/p1", "第1页")).document;
    },
  });
  session.apply({ autoPage: false });
  await pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 850 });
  assert.equal(calls, 0);
  assert.equal(pager.stopped, false);
  session.apply({ autoPage: true });
  await pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 850 });
  assert.equal(calls, 1);
});

test("没有新结果或接满 10 页后停止，且重复链接不再接入", async () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "single",
    highlight: false,
    autoPage: true,
  });
  let page = 0;
  const pager = createAutoPager({
    document,
    session,
    url: "https://www.baidu.com/s?wd=chrome",
    fetchDocument: async () => {
      page += 1;
      if (page === 1) {
        return parseHTML(resultPage("https://example.com/a", "重复")).document;
      }
      return parseHTML(resultPage(`https://example.com/p${page}`, `第${page}页`)).document;
    },
  });
  const near = { scrollY: 0, viewportHeight: 800, listBottom: 850 };
  const duplicate = await pager.check(near);
  assert.equal(duplicate.stopped, true);
  assert.equal(pager.stopped, true);
  assert.equal(session.appendedPages, 0);

  const freshDoc = parseHTML(baiduPage("chrome")).document;
  const freshSession = createSearchSession(freshDoc, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "single",
    highlight: false,
    autoPage: true,
  });
  let n = 0;
  const freshPager = createAutoPager({
    document: freshDoc,
    session: freshSession,
    url: "https://www.baidu.com/s?wd=chrome",
    fetchDocument: async () => {
      n += 1;
      return parseHTML(resultPage(`https://example.com/p${n}`, `第${n}页`)).document;
    },
  });
  for (let i = 0; i < 11; i += 1) await freshPager.check(near);
  assert.equal(freshSession.appendedPages, 10);
  assert.equal(freshPager.stopped, true);
  assert.equal(n, 10);
  assert.equal(freshDoc.getElementById("page").textContent, "下一页");
});

test("自动翻页关掉时滚动不再取下一页", async () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const session = createSearchSession(document, "https://www.baidu.com/s?wd=chrome", {
    columnMode: "original",
    highlight: false,
    autoPage: false,
  });
  let calls = 0;
  const pager = createAutoPager({
    document,
    session,
    url: "https://www.baidu.com/s?wd=chrome",
    enabled: false,
    fetchDocument: async () => {
      calls += 1;
      return parseHTML(resultPage("https://example.com/p1", "第1页")).document;
    },
  });
  await pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 850 });
  assert.equal(calls, 0);
  pager.setEnabled(true);
  session.apply({ autoPage: true });
  await pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 850 });
  assert.equal(calls, 1);
});

test("靠近底部的判定看结果列表底边", () => {
  assert.equal(isNearBottom(parseHTML("<div></div>").document, {
    scrollY: 0,
    viewportHeight: 800,
    listBottom: 1700,
  }, 800), false);
  assert.equal(isNearBottom(parseHTML("<div></div>").document, {
    scrollY: 0,
    viewportHeight: 800,
    listBottom: 1400,
  }, 800), true);
});

test("百度启动默认打开自动翻页", () => {
  const { document } = parseHTML(baiduPage("chrome"));
  const boot = bootBaiduPage(document, "https://www.baidu.com/s?wd=chrome", {}, { attachScroll: false });
  assert.equal(boot.pager.enabled, true);
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

function resultPage(href, title) {
  return `<!doctype html><html><body><div id="content_left">
    <div class="c-container"><h3><a href="${href}">${title}</a></h3><div class="c-abstract">${title}</div></div>
  </div></body></html>`;
}
