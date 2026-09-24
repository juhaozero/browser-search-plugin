import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createSearchSession, isDesktopWebSearch, nextPageUrl } from "../src/search-session.mjs";

test("只认桌面版网页搜索", () => {
  assert.equal(isDesktopWebSearch("https://www.google.com/search?q=chrome"), true);
  assert.equal(isDesktopWebSearch("https://www.bing.com/search?q=chrome"), true);
  assert.equal(isDesktopWebSearch("https://www.google.com/"), false);
  assert.equal(isDesktopWebSearch("https://www.google.com/search?q=chrome&tbm=isch"), false);
  assert.equal(isDesktopWebSearch("https://www.baidu.com/s?wd=chrome"), false);
  assert.equal(isDesktopWebSearch("https://www.bing.com/images/search?q=chrome"), false);
});

test("下一页地址从当前页往后推一页", () => {
  assert.equal(
    nextPageUrl("https://www.google.com/search?q=chrome"),
    "https://www.google.com/search?q=chrome&start=10",
  );
  assert.equal(
    nextPageUrl("https://www.bing.com/search?q=chrome"),
    "https://www.bing.com/search?q=chrome&first=11",
  );
  assert.equal(nextPageUrl("https://www.google.com/"), null);
  assert.equal(nextPageUrl("https://www.baidu.com/s?wd=chrome"), null);
});

test("双列只搬走结果条目，页码和相关搜索留在原地", () => {
  const { document } = parseHTML(googlePage("chrome"));
  createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "double",
    autoPage: false,
  });
  const box = document.getElementById("bsp-results");
  assert.equal(box.querySelectorAll(".g, .tF2Cxc").length >= 1, true);
  assert.equal(box.contains(document.getElementById("pnnext")?.parentElement), false);
});

test("原始模式不搬动结果条目", () => {
  const { document } = parseHTML(googlePage("chrome"));
  createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "original",
    autoPage: false,
  });
  assert.equal(document.getElementById("bsp-results"), null);
  assert.ok(document.querySelector("#rso .g, #rso .tF2Cxc, #rso h3"));
});

test("单列居中是单独的一种列模式", () => {
  const { document } = parseHTML(googlePage("chrome"));
  createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "single-center",
    autoPage: false,
  });
  assert.equal(document.getElementById("bsp-results").dataset.mode, "single-center");
});

test("切回原始模式时本页结果条目回到原位，已接入的留在列表末尾", () => {
  const { document } = parseHTML(googlePage("chrome"));
  const session = createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "double",
    autoPage: true,
  });
  session.ingest(parseHTML(`<div id="rso"><div class="g"><h3><a href="https://example.com/c">丙</a></h3></div></div>`).document);
  session.apply({ columnMode: "original" });
  assert.equal(document.getElementById("bsp-results"), null);
  assert.ok([...document.querySelectorAll("#rso a")].some((a) => a.getAttribute("href") === "https://example.com/c"));
});

test("接上下一页时跳过已有链接，没有新结果就停，最多再接 10 页", () => {
  const { document } = parseHTML(googlePage("chrome"));
  const session = createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "single-center",
    autoPage: true,
  });
  const { document: fresh } = parseHTML(googlePage("chrome"));
  assert.equal(session.ingest(fresh).added, 0);
  assert.equal(session.ingest(fresh).stopped, true);
});

test("自动翻页关掉时不再接入下一页", () => {
  const { document } = parseHTML(googlePage("chrome"));
  const session = createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "single-center",
    autoPage: false,
  });
  assert.equal(session.ingest(parseHTML(googlePage("other")).document).added, 0);
});

test("紧挨的多条结果从每种列模式切回原始模式时保持原顺序", () => {
  for (const mode of ["single", "single-center", "double"]) {
    const { document } = parseHTML(googlePage("chrome"));
    const session = createSearchSession(document, "https://www.google.com/search?q=chrome", {
      columnMode: mode,
      autoPage: false,
    });
    session.apply({ columnMode: "original" });
    const hrefs = [...document.querySelectorAll("#rso h3 a")].map((link) => link.getAttribute("href"));
    assert.ok(hrefs.includes("https://example.com/a"));
  }
});

function googlePage(query) {
  return `<!doctype html><html><body>
    <div id="rso">
      <div class="g"><h3><a href="https://example.com/a">${query} 下载</a></h3><div class="VwiC3b">摘要 a</div></div>
      <div class="g"><h3><a href="https://example.com/b">${query} 官网</a></h3><div class="VwiC3b">摘要 b</div></div>
    </div>
    <a id="pnnext" href="/search?q=${query}&amp;start=10">下一页</a>
  </body></html>`;
}
