import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createAutoPager } from "../src/auto-page.mjs";
import { bootSearchPage } from "../src/content-boot.mjs";
import { createSearchSession } from "../src/search-session.mjs";
import { assertNoNode } from "./assert-dom.mjs";

test("谷歌网页搜索默认单列居中", async () => {
  const { document } = parseHTML(googlePage("chrome 扩展"));
  const boot = await bootSearchPage(document, "https://www.google.com/search?q=chrome%20%E6%89%A9%E5%B1%95", {
    viewportWidth: 1200,
    parentLeft: 80,
  }, { attachScroll: false, watchDom: false });
  assert.ok(boot?.session);
  assert.equal(boot.session.engine, "google");
  const box = document.getElementById("bsp-results");
  assert.equal(box.dataset.mode, "single-center");
  assert.equal(document.getElementById("pnnext").textContent, "下一页");
  assert.equal(box.contains(document.getElementById("pnnext")), false);
  boot.dispose();
});

test("谷歌首页、图片和带国家域名的判定", async () => {
  assert.equal(
    await bootSearchPage(
      parseHTML(googlePage("chrome")).document,
      "https://www.google.com/",
      {},
      { attachScroll: false, watchDom: false },
    ),
    null,
  );
  assert.equal(
    await bootSearchPage(
      parseHTML(googlePage("chrome")).document,
      "https://www.google.com/search?q=chrome&tbm=isch",
      {},
      { attachScroll: false, watchDom: false },
    ),
    null,
  );
  const hk = await bootSearchPage(
    parseHTML(googlePage("chrome")).document,
    "https://www.google.com.hk/search?q=chrome",
    {},
    { attachScroll: false, watchDom: false },
  );
  assert.ok(hk?.session);
  assert.equal(hk.session.engine, "google");
  hk.dispose();
});

test("谷歌无 .g 的 MjjYud / tF2Cxc 结果也能单列居中", async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div id="rso">
      <div class="MjjYud"><div class="tF2Cxc">
        <a href="https://example.com/modern"><h3>chrome 扩展</h3></a>
        <div class="VwiC3b">现代结构 chrome 扩展</div>
      </div></div>
    </div>
    <a id="pnnext" href="/search?q=chrome&amp;start=10">下一页</a>
  </body></html>`);
  const boot = await bootSearchPage(document, "https://www.google.com/search?q=chrome%20%E6%89%A9%E5%B1%95", {
    viewportWidth: 1200,
    parentLeft: 80,
  }, { attachScroll: false, watchDom: false });
  assert.ok(boot?.session);
  const box = document.getElementById("bsp-results");
  assert.equal(box.dataset.mode, "single-center");
  assert.equal(box.children.length, 1);
  assert.equal(document.documentElement.dataset.bspActive, "1");
  boot.dispose();
});

test("结果晚到时 refresh 会补上列模式", () => {
  const { document } = parseHTML(`<!doctype html><html><body><div id="rso"></div></body></html>`);
  const session = createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "double",
    autoPage: true,
  });
  assert.equal(document.getElementById("bsp-results")?.children.length ?? 0, 0);
  document.getElementById("rso").innerHTML = `<div class="tF2Cxc">
    <a href="https://example.com/late"><h3>chrome</h3></a>
    <div class="VwiC3b">晚到的 chrome</div>
  </div>`;
  session.refresh();
  assert.equal(document.getElementById("bsp-results").children.length, 1);
});

test("谷歌双列不把空壳 MjjYud 当成结果卡片", () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div id="rso">
      <div class="MjjYud"></div>
      <div class="tF2Cxc">
        <a href="https://example.com/a"><h3>Workers AI</h3></a>
        <div class="VwiC3b">摘要一</div>
      </div>
      <div class="tF2Cxc">
        <a href="https://example.com/b"><h3>教程</h3></a>
        <div class="VwiC3b">摘要二</div>
      </div>
    </div>
  </body></html>`);
  createSearchSession(document, "https://www.google.com/search?q=workers", {
    columnMode: "double",
    autoPage: false,
  });
  const box = document.getElementById("bsp-results");
  assert.equal(box.children.length, 2);
  assert.equal(box.querySelectorAll("h3").length, 2);
});

test("谷歌广告和知识卡不被搬走", () => {
  const { document } = parseHTML(googlePage("chrome"));
  createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "double",
    autoPage: true,
  });
  const box = document.getElementById("bsp-results");
  assert.equal(box.querySelectorAll(".g").length, 1);
  assertNoNode(document.querySelector("#tads .g").closest("#bsp-results"));
  assertNoNode(document.querySelector("#rhs").closest("#bsp-results"));
});

test("谷歌切回原始模式时本页结果回到原位，已接入的留在末尾", () => {
  const { document } = parseHTML(googlePage("chrome"));
  const session = createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "double",
    autoPage: true,
  });
  session.ingest(parseHTML(googleResult("https://example.com/p1", "下一页 chrome")).document);
  session.apply({ columnMode: "original" });
  assertNoNode(document.getElementById("bsp-results"));
  const root = document.getElementById("rso");
  assert.equal(root.querySelector("a[href='https://example.com/a']").closest(".g").parentElement, root.querySelector(".MjjYud") ?? root);
  assert.ok(root.querySelector("a[href='https://example.com/p1']"));
  assert.equal(document.getElementById("pnnext").textContent, "下一页");
});

test("谷歌自动翻页接上结果并保留页码", async () => {
  const { document } = parseHTML(googlePage("chrome"));
  const session = createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "single-center",
    autoPage: true,
  });
  const pager = createAutoPager({
    document,
    session,
    url: "https://www.google.com/search?q=chrome",
    fetchDocument: async (url) => {
      assert.equal(url, "https://www.google.com/search?q=chrome&start=10");
      return parseHTML(googleResult("https://example.com/p1", "第1页 chrome")).document;
    },
  });
  const result = await pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 900 });
  assert.equal(result.fetched, true);
  assert.ok(document.querySelector("#bsp-results a[href='https://example.com/p1']"));
  assert.equal(document.getElementById("pnnext").textContent, "下一页");
  pager.dispose();
  session.dispose();
});

test("谷歌取页失败提示可重试", async () => {
  const { document } = parseHTML(googlePage("chrome"));
  const session = createSearchSession(document, "https://www.google.com/search?q=chrome", {
    columnMode: "original",
    autoPage: true,
  });
  let fail = true;
  /** @type {Array<() => void>} */
  const scheduled = [];
  const pager = createAutoPager({
    document,
    session,
    url: "https://www.google.com/search?q=chrome",
    schedule: (fn) => {
      scheduled.push(fn);
      return 1;
    },
    fetchDocument: async () => {
      if (fail) throw new Error("network");
      return parseHTML(googleResult("https://example.com/p1", "第1页")).document;
    },
  });
  const near = { scrollY: 0, viewportHeight: 800, listBottom: 900 };
  await pager.check(near);
  assert.equal(document.getElementById("bsp-status").textContent, "加载失败");
  fail = false;
  await pager.check(near);
  assertNoNode(document.querySelector("a[href='https://example.com/p1']"));
  await pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 2000 });
  const retried = await pager.check(near);
  assert.equal(retried.fetched, true);
  scheduled[0]();
  assert.equal(document.getElementById("bsp-status").hidden, true);
});

test("清单匹配谷歌搜索路径且不申请落地页权限", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const serialized = JSON.stringify(manifest);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts[0].matches.includes("https://www.google.com/search*"), true);
  assert.equal(manifest.content_scripts[0].matches.includes("https://www.google.com.hk/search*"), true);
  assert.equal(serialized.includes("<all_urls>"), false);
});

test("谷歌网页结果允许 udm=14，图片 udm 仍排除", async () => {
  const web = await bootSearchPage(
    parseHTML(googlePage("chrome")).document,
    "https://www.google.com/search?q=chrome&udm=14",
    {},
    { attachScroll: false, watchDom: false },
  );
  assert.ok(web?.session);
  web.dispose();
  assert.equal(
    await bootSearchPage(
      parseHTML(googlePage("chrome")).document,
      "https://www.google.com/search?q=chrome&udm=2",
      {},
      { attachScroll: false, watchDom: false },
    ),
    null,
  );
});

function googlePage(query) {
  return `<!doctype html><html><body>
    <textarea name="q">${query}</textarea>
    <div id="tads"><div class="uEierd"><div class="g"><h3><a href="https://ad.example/x">广告 ${query}</a></h3></div></div></div>
    <div id="rso">
      <div class="MjjYud"><div class="g">
        <a href="https://example.com/a"><h3>${query} 下载</h3></a>
        <div class="VwiC3b">这是 ${query} 的摘要</div>
      </div></div>
    </div>
    <div id="rhs"><div class="kp-wholepage">知识卡 ${query}</div></div>
    <a id="pnnext" href="/search?q=chrome&amp;start=10">下一页</a>
  </body></html>`;
}

function googleResult(href, title) {
  return `<!doctype html><html><body><div id="rso"><div class="g">
    <a href="${href}"><h3>${title}</h3></a>
    <div class="VwiC3b">${title}</div>
  </div></div></body></html>`;
}
