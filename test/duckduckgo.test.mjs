import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { bootSearchPage } from "../src/boot.mjs";
import { searchPageKey } from "../src/content-lifecycle.mjs";
import { findResultsShell } from "../src/layout-gate.mjs";
import { destinationUrl } from "../src/result-tools.mjs";
import { isDesktopWebSearch, nextPageUrl } from "../src/search-session.mjs";

const url = "https://duckduckgo.com/?q=example";
const nearBottom = { listBottom: 100, viewportHeight: 100 };
const item = (id, host = "example.com") =>
  `<li id="${id}" data-layout="organic"><article data-testid="result"><h2><a data-testid="result-title-a" href="https://${host}/${id}">${id}</a></h2></article></li>`;

function fixture() {
  return parseHTML(`<!doctype html><html><body>
    <div id="web_content_wrapper"><div id="react-layout"><div><div>
      <section data-testid="mainline">
        <ol class="react-results--main">
          <li id="ad" data-layout="ad"><a data-testid="result-title-a" href="https://example.com/ad">Ad</a></li>
          ${item("first")}
          <li id="module">Native search module</li>
          ${item("second", "other.example")}
        </ol>
        <button id="more-results">More results</button>
      </section>
      <section data-testid="sidebar">Native sidebar</section>
    </div></div></div></div>
  </body></html>`).document;
}

test("DuckDuckGo 只识别根路径的网页查询，筛选变化重建会话", () => {
  assert.equal(isDesktopWebSearch(url), true);
  assert.equal(isDesktopWebSearch(`${url}&ia=web`), true);
  for (const candidate of [
    "https://duckduckgo.com/",
    "https://duckduckgo.com/?q=%20",
    "https://duckduckgo.com/html/?q=example",
    "https://duckduckgo.com/?q=example&ia=images",
    "https://duckduckgo.com/?q=example&iax=videos",
    "https://duckduckgo.com/?q=example&ia=chat",
    "https://duckduckgo.com.example.com/?q=example",
    "http://duckduckgo.com/?q=example",
  ]) assert.equal(isDesktopWebSearch(candidate), false, candidate);
  assert.equal(searchPageKey(`${url}&ia=web&t=browser`), searchPageKey(url));
  assert.notEqual(searchPageKey(`${url}&df=w`), searchPageKey(url));
  assert.notEqual(searchPageKey(`${url}&ia=videos`), searchPageKey(url));
  assert.equal(nextPageUrl(url), null);
  assert.equal(destinationUrl("/l/?uddg=https%3A%2F%2Fexample.org%2F", url, "duckduckgo"), "https://example.org/");
});

test("DuckDuckGo 原地切换布局，保留原生节点并复用本页域名过滤", async () => {
  const document = fixture();
  const list = findResultsShell(document);
  const children = [...list.children];
  const boot = await bootSearchPage(document, url, {}, { prefs: { columnMode: "double", autoPage: false }, attachScroll: false });
  assert.equal(boot.session.engine, "duckduckgo");
  assert.deepEqual(boot.session.items.map(element => element.id), ["first", "second"]);
  assert.equal(document.documentElement.dataset.bspColumnMode, "double");
  for (const mode of ["single", "single-center", "original"]) {
    boot.applyPrefs({ columnMode: mode, autoPage: false });
    assert.equal(document.documentElement.dataset.bspColumnMode, mode === "original" ? undefined : mode);
    assert.deepEqual([...list.children], children);
  }
  assert.deepEqual(boot.pageDomains.set("example.com"), { ok: true, domains: ["example.com"], count: 1 });
  assert.equal(document.getElementById("first").dataset.bspDomainHidden, "true");
  assert.equal(document.getElementById("ad").dataset.bspDomainHidden, undefined);
  boot.dispose();
  assert.equal(document.documentElement.dataset.bspEngine, undefined);
  assert.equal(document.getElementById("first").hasAttribute("data-bsp-domain-hidden"), false);
});

test("DuckDuckGo 原生续载等待新结果，防止重复点击并支持批次暂停", async () => {
  const document = fixture();
  const list = findResultsShell(document);
  const button = document.getElementById("more-results");
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks += 1;
    setTimeout(() => list.insertAdjacentHTML("beforeend", item(`new-${clicks}`)), 10);
  });
  const boot = await bootSearchPage(document, url, {}, {
    prefs: { columnMode: "double", pagesPerBatch: 1 },
    attachScroll: false,
    fetchDocument: () => assert.fail("DuckDuckGo uses its native button"),
  });
  try {
    button.disabled = true;
    assert.equal((await boot.pager.check(nearBottom)).fetched, false);
    button.disabled = false;
    const loading = boot.pager.check(nearBottom);
    assert.equal((await boot.pager.check(nearBottom)).fetched, false);
    assert.equal((await loading).added, 1);
    assert.equal(boot.pager.stopped, true);
    assert.equal(clicks, 1);
    assert.equal(boot.session.appendedPages, 1);
    assert.equal(document.getElementById("new-1").parentElement, list);
    assert.ok(document.getElementById("new-1").hasAttribute("data-bsp-result"));
    await boot.pager.continueLoading();
    assert.equal(clicks, 2);
    assert.equal(boot.session.appendedPages, 2);
    boot.applyPrefs({ columnMode: "double", autoPage: false, pagesPerBatch: 1 });
    assert.equal((await boot.pager.check(nearBottom)).fetched, false);
    assert.equal(clicks, 2);
  } finally {
    boot.dispose();
  }
});

test("DuckDuckGo 离开搜索页时取消等待原生结果", async () => {
  const document = fixture();
  const boot = await bootSearchPage(document, url, {}, { attachScroll: false });
  const loading = boot.pager.check(nearBottom);
  boot.dispose();
  assert.equal((await loading).fetched, false);
  assert.equal(document.getElementById("bsp-status"), null);
  assert.equal(boot.session.appendedPages, 0);
});

test("DuckDuckGo 隐藏追加的重复结果，末页请求期间关闭再打开时保留结束状态", async () => {
  const document = fixture();
  const list = findResultsShell(document);
  const button = document.getElementById("more-results");
  const prefs = { pagesPerBatch: 1, autoPage: true };
  const boot = await bootSearchPage(document, url, {}, { prefs, attachScroll: false });
  try {
    const loading = boot.pager.check(nearBottom);
    boot.applyPrefs({ ...prefs, autoPage: false });
    list.insertAdjacentHTML("beforeend", item("first").replace('id="first"', 'id="duplicate"'));
    await new Promise(resolve => setTimeout(resolve, 150));
    list.insertAdjacentHTML("beforeend", item("last"));
    button.remove();
    assert.equal((await loading).fetched, false);
    const duplicate = document.getElementById("duplicate");
    assert.ok(duplicate.hasAttribute("data-bsp-duplicate-result"));
    assert.deepEqual(boot.session.items.map(element => element.id), ["first", "second", "last"]);
    boot.applyPrefs(prefs);
    assert.equal(boot.pager.stopped, true);
    assert.match(document.getElementById("bsp-status").textContent, /No more|没有更多/);
    assert.equal(document.querySelectorAll("#bsp-status button").length, 1);
    boot.dispose();
    assert.equal(duplicate.hasAttribute("data-bsp-duplicate-result"), false);
  } finally {
    boot.dispose();
  }
});

test("DuckDuckGo 一批全是重复结果时，原生按钮仍可加载下一批", async () => {
  const document = fixture();
  const list = findResultsShell(document);
  const button = document.getElementById("more-results");
  const boot = await bootSearchPage(document, url, {}, { prefs: { pagesPerBatch: 2 }, attachScroll: false });
  button.addEventListener("click", () => { button.disabled = true; }, { once: true });
  try {
    const loading = boot.pager.check(nearBottom);
    list.insertAdjacentHTML("beforeend", item("first").replace('id="first"', 'id="duplicate"'));
    button.disabled = false;
    assert.deepEqual(await loading, { added: 0, fetched: false, stopped: false });
    button.addEventListener("click", () => list.insertAdjacentHTML("beforeend", item("new")), { once: true });
    assert.equal((await boot.pager.check(nearBottom)).added, 1);
    assert.equal(boot.session.appendedPages, 2);
  } finally {
    boot.dispose();
  }
});

test("DuckDuckGo 原生按钮重新挂载后可以从暂时的末页恢复", async () => {
  const document = fixture();
  const list = findResultsShell(document);
  const button = document.getElementById("more-results");
  const boot = await bootSearchPage(document, url, {}, { prefs: { pagesPerBatch: 1 }, attachScroll: false });
  button.addEventListener("click", () => {
    button.remove();
    list.insertAdjacentHTML("beforeend", item("page2"));
  }, { once: true });
  try {
    assert.equal((await boot.pager.check(nearBottom)).stopped, true);
    assert.match(document.getElementById("bsp-status").textContent, /No more|没有更多/);
    list.after(button);
    button.addEventListener("click", () => list.insertAdjacentHTML("beforeend", item("page3")), { once: true });
    await boot.pager.check(nearBottom);
    assert.match(document.getElementById("bsp-status").textContent, /paused|暂停/);
    assert.equal((await boot.pager.continueLoading()).added, 1);
  } finally {
    boot.dispose();
  }
});
