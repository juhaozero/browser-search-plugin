import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { bootSearchPage } from "../src/content-boot.mjs";
import { createContentLifecycle, searchPageKey } from "../src/content-lifecycle.mjs";

function baiduDoc() {
  return parseHTML(`<!doctype html><html><body>
    <div id="head"></div>
    <div id="content_left">
      <div class="c-container"><h3><a href="https://example.com/a">甲</a></h3><div class="c-abstract">摘要甲</div></div>
      <div class="c-container"><h3><a href="https://example.com/b">乙</a></h3><div class="c-abstract">摘要乙</div></div>
    </div>
    <div id="page">下一页</div>
  </body></html>`).document;
}

test("boot 后应有 bsp-results 且为单列居中", async () => {
  const document = baiduDoc();
  const boot = await bootSearchPage(
    document,
    "https://www.baidu.com/s?wd=chrome",
    { viewportWidth: 1200 },
    { attachScroll: false, watchDom: false },
  );
  assert.ok(boot);
  const box = document.getElementById("bsp-results");
  assert.ok(box);
  assert.equal(box.dataset.mode, "single-center");
  assert.equal(box.children.length, 2);
  assert.equal(document.documentElement.dataset.bspActive, "1");
  boot.dispose();
});

test("同查询不同追踪参数应视为同一搜索页", () => {
  assert.equal(
    searchPageKey("https://www.baidu.com/s?wd=chrome"),
    searchPageKey("https://www.baidu.com/s?wd=chrome&rsv_spt=1&bs=chrome"),
  );
  assert.notEqual(
    searchPageKey("https://www.baidu.com/s?wd=chrome"),
    searchPageKey("https://www.baidu.com/s?wd=edge"),
  );
});

test("replaceState 加追踪参数不应 dispose 掉已激活的 boot", async () => {
  const document = baiduDoc();
  let boots = 0;
  const lifecycle = createContentLifecycle({
    isDesktopWebSearch: (url) => url.includes("baidu.com/s"),
    bootSearchPage: async (doc, url) => {
      boots += 1;
      return bootSearchPage(doc, url, { viewportWidth: 1200 }, {
        attachScroll: false,
        watchDom: false,
        prefs: { columnMode: "single-center", highlight: false, autoPage: false },
      });
    },
  });

  const url1 = "https://www.baidu.com/s?wd=chrome";
  const url2 = "https://www.baidu.com/s?wd=chrome&rsv_spt=1&oq=chrome";
  await lifecycle.start(document, url1, "boot");
  assert.equal(boots, 1);
  assert.ok(document.getElementById("bsp-results"));

  // 模拟加载期多次带追踪参数的 navigate
  await Promise.all([
    lifecycle.start(document, url2, "navigate"),
    lifecycle.start(document, `${url2}&foo=1`, "navigate"),
    lifecycle.start(document, `${url2}&bar=2`, "navigate"),
  ]);

  assert.equal(boots, 1, "同查询不应重复 boot");
  assert.ok(lifecycle.getActive());
  assert.ok(document.getElementById("bsp-results"), "结果盒应仍在");
  assert.equal(document.getElementById("bsp-results").children.length, 2);
});

test("并发同查询 boot 风暴后最终仍应保留结果盒", async () => {
  const document = baiduDoc();
  let boots = 0;
  const lifecycle = createContentLifecycle({
    isDesktopWebSearch: () => true,
    bootSearchPage: async (doc, url) => {
      boots += 1;
      await new Promise((r) => setTimeout(r, 5 + (boots % 3)));
      return bootSearchPage(doc, url, { viewportWidth: 1200 }, {
        attachScroll: false,
        watchDom: false,
        prefs: { columnMode: "double", highlight: false, autoPage: false },
      });
    },
  });

  const base = "https://www.baidu.com/s?wd=test";
  await Promise.all([
    lifecycle.start(document, base, "boot"),
    lifecycle.start(document, `${base}&a=1`, "navigate"),
    lifecycle.start(document, `${base}&b=2`, "navigate"),
    lifecycle.start(document, `${base}&c=3`, "navigate"),
  ]);

  const box = document.getElementById("bsp-results");
  assert.ok(lifecycle.getActive(), "应有激活实例");
  assert.ok(box, "应有结果盒");
  assert.equal(box.dataset.mode, "double");
});
