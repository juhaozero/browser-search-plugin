import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { bootSearchPage } from "../src/content-boot.mjs";
import { createContentLifecycle, searchPageKey } from "../src/content-lifecycle.mjs";
import { isDesktopWebSearch } from "../src/search-session.mjs";

function googleDoc() {
  return parseHTML(`<!doctype html><html><body>
    <div id="rso">
      <div class="g"><h3><a href="https://example.com/a">chrome</a></h3></div>
    </div>
  </body></html>`).document;
}

test("boot 后应有 bsp-results 且为单列居中", async () => {
  const document = googleDoc();
  const boot = await bootSearchPage(
    document,
    "https://www.google.com/search?q=chrome",
    { viewportWidth: 1200 },
    { attachScroll: false, watchDom: false },
  );
  assert.ok(boot?.session);
  assert.equal(document.getElementById("bsp-results")?.dataset.mode, "single-center");
  boot.dispose();
});

test("同查询不同追踪参数应视为同一搜索页", () => {
  assert.equal(
    searchPageKey("https://www.google.com/search?q=chrome"),
    searchPageKey("https://www.google.com/search?q=chrome&ei=ABC&start=0"),
  );
  assert.notEqual(
    searchPageKey("https://www.google.com/search?q=chrome"),
    searchPageKey("https://www.google.com/search?q=edge"),
  );
});

test("replaceState 加追踪参数不应 dispose 掉已激活的 boot", async () => {
  const document = googleDoc();
  const lifecycle = createContentLifecycle({
    bootSearchPage,
    isDesktopWebSearch: (url) => url.includes("google.com/search"),
  });
  const url1 = "https://www.google.com/search?q=chrome";
  const url2 = "https://www.google.com/search?q=chrome&ei=xyz";
  const first = await lifecycle.start(document, url1, "boot");
  assert.ok(first);
  const second = await lifecycle.start(document, url2, "navigate");
  assert.equal(second, first);
  assert.ok(document.getElementById("bsp-results"));
  lifecycle.disposeAll();
});

test("并发同查询 boot 风暴后最终仍应保留结果盒", async () => {
  const document = googleDoc();
  const lifecycle = createContentLifecycle({ bootSearchPage, isDesktopWebSearch });
  const base = "https://www.google.com/search?q=test";
  await Promise.all([
    lifecycle.start(document, base, "boot"),
    lifecycle.start(document, `${base}&ei=1`, "navigate"),
    lifecycle.start(document, `${base}&ei=2`, "navigate"),
  ]);
  assert.ok(document.getElementById("bsp-results"));
  lifecycle.disposeAll();
});
