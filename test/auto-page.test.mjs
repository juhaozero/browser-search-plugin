import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createAutoPager, fetchHtmlDocument } from "../src/auto-page.mjs";
import { createSearchSession } from "../src/search-session.mjs";

const near = { scrollY: 0, viewportHeight: 800, listBottom: 900 };
const url = "https://www.google.com/search?q=test";
function page(n = 0) {
  return parseHTML(`<html lang="zh-CN"><body><div id="rso"><div class="g"><a href="https://example.com/${n}"><h3>Result</h3></a></div></div>
    <a id="pnnext" href="/search?q=test&start=${(n + 1) * 10}">Next</a></body></html>`).document;
}
function setup(fetchDocument) {
  const document = page();
  const session = createSearchSession(document, url, { columnMode: "double", autoPage: true });
  return { document, session, pager: createAutoPager({ document, session, url, fetchDocument }) };
}

test("失败提示保留，点击重试不会要求先滚离底部，忙碌时不重复请求", async () => {
  let requests = 0, finish;
  const { document, session, pager } = setup(async () => {
    if (++requests === 1) throw new Error("offline");
    return new Promise(resolve => { finish = resolve; });
  });
  try {
    assert.equal((await pager.check(near)).failed, true);
    assert.match(document.querySelector(".bsp-status-message").textContent, /加载失败/);
    assert.equal(document.getElementById("bsp-status").hidden, false);
    await pager.check(near);
    assert.equal(requests, 1);
    document.querySelector("#bsp-status button").click();
    await pager.retry();
    assert.equal(requests, 2);
    finish(page(1));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(session.appendedPages, 1);
    assert.match(document.querySelector(".bsp-status-message").textContent, /已追加 1 页/);
    assert.equal(document.querySelector("#bsp-status button").textContent, "返回顶部");
  } finally { pager.dispose(); session.dispose(); }
});

test("追加十页后暂停，点击继续后可加载下一批并再次暂停", async () => {
  let requests = 0;
  const { document, session, pager } = setup(async () => page(++requests));
  try {
    for (let n = 0; n < 10; n++) await pager.check(near);
    assert.equal(session.appendedPages, 10);
    assert.equal(pager.stopped, true);
    assert.match(document.querySelector(".bsp-status-message").textContent, /已暂停自动加载.*10 页/);
    await pager.check(near);
    assert.equal(requests, 10);
    document.querySelector("#bsp-status button").click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(session.appendedPages, 11);
    assert.equal(pager.stopped, false);
    for (let n = 11; n < 20; n++) await pager.check(near);
    assert.equal(session.appendedPages, 20);
    assert.equal(pager.stopped, true);
    assert.match(document.querySelector(".bsp-status-message").textContent, /20 页/);
    pager.setEnabled(false);
    assert.equal(document.getElementById("bsp-status").hidden, true);
    pager.setEnabled(true);
    assert.equal(document.getElementById("bsp-status").hidden, false);
  } finally { pager.dispose(); session.dispose(); }
});

test("没有新结果时显示停止原因且不提供继续按钮", async () => {
  const { document, session, pager } = setup(async () => page());
  try {
    assert.equal((await pager.check(near)).stopped, true);
    assert.match(document.querySelector(".bsp-status-message").textContent, /没有更多新结果/);
    assert.equal(document.querySelector("#bsp-status button"), null);
    assert.equal((await pager.continueLoading()).fetched, false);
  } finally { pager.dispose(); session.dispose(); }
});

test("关闭自动翻页后不接入未完成请求，释放后旧按钮不再触发请求", async () => {
  let finish, requests = 0;
  const { document, session, pager } = setup(async () => {
    requests++;
    return new Promise(resolve => { finish = resolve; });
  });
  const loading = pager.check(near);
  pager.setEnabled(false);
  finish(page(1));
  await loading;
  assert.equal(session.appendedPages, 0);
  assert.equal(document.getElementById("bsp-status").hidden, true);
  pager.dispose();
  assert.equal(document.getElementById("bsp-status"), null);
  await pager.retry();
  assert.equal(requests, 1);
  session.dispose();
});

test("必应状态栏位于结果列表外并随会话释放", async () => {
  const document = parseHTML('<html lang="en"><body><ol id="b_results"><li class="b_algo"><h2><a href="https://example.com">Result</a></h2></li><li class="b_pag"><a class="sb_pagN" href="/search?q=test&first=11">Next</a></li></ol></body></html>').document;
  const bingUrl = "https://www.bing.com/search?q=test";
  const session = createSearchSession(document, bingUrl, { columnMode: "double", autoPage: true });
  const pager = createAutoPager({ document, session, url: bingUrl, fetchDocument: async () => { throw new Error("offline"); } });
  await pager.check(near);
  assert.equal(document.querySelector("#b_results #bsp-status"), null);
  assert.equal(document.querySelector("#bsp-status button").textContent, "Retry");
  pager.dispose();
  session.dispose();
  assert.equal(document.getElementById("bsp-status"), null);
});

test("谷歌分页位于表格时，状态区不挤进页码单元格", async () => {
  const document = page();
  document.getElementById("pnnext").remove();
  document.body.insertAdjacentHTML("beforeend", '<table><tr><td><a id="pnnext" href="/search?q=test&start=10">Next</a></td></tr></table>');
  const session = createSearchSession(document, url, { columnMode: "double", autoPage: true });
  const pager = createAutoPager({ document, session, url, fetchDocument: async () => { throw new Error("offline"); } });
  await pager.check(near);
  assert.equal(document.getElementById("bsp-status").parentElement, document.body);
  pager.dispose();
  session.dispose();
});

test("下一页网络错误和验证页面作为失败处理，并保留请求取消能力", async () => {
  const originalFetch = globalThis.fetch;
  const originalParser = globalThis.DOMParser;
  try {
    globalThis.DOMParser = class { parseFromString(html) { return parseHTML(html).document; } };
    globalThis.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(fetchHtmlDocument(url), /429/);
    globalThis.fetch = async () => ({ ok: true, text: async () => '<html><body>Verify you are human</body></html>' });
    await assert.rejects(fetchHtmlDocument(url), /未返回搜索结果/);
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.credentials, "include");
      options.signal.throwIfAborted();
    };
    await assert.rejects(fetchHtmlDocument(url, controller.signal), { name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = originalParser;
  }
});
