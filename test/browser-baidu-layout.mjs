import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

test("installed extension applies Baidu layout on the first search without a reload", async () => {
  const executablePath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].find(existsSync);
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, enableExtensions: true, args: ["--no-sandbox"] });
  try {
    const id = await browser.installExtension(resolve("extension"));
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.evaluate(() => chrome.storage.sync.set({ prefs: { columnMode: "double", autoPage: false } }));
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    await page.setViewport({ width: 1440, height: 900 });
    page.on("request", request => {
      if (!request.isNavigationRequest()) { void request.abort(); return; }
      void request.respond({ status: 200, contentType: "text/html", body: `<!doctype html>
        <form id="home"><input name="wd" value="example"><button>Search</button></form>
        <script>
          document.getElementById('home').addEventListener('submit', event => {
            event.preventDefault();
            history.pushState({}, '', '/s?wd=example');
            requestAnimationFrame(() => {
              document.body.innerHTML = '<div id="wrapper"><div id="container"><div id="content_left"><div class="result c-container"><h3><a href="https://example.com/">Result</a></h3></div></div></div></div>';
            });
          });
        </script>` });
    });
    await page.goto("https://www.baidu.com/?from=fixture");
    assert.equal(await page.$eval("#home", form => getComputedStyle(form.parentElement).opacity), "1");
    assert.equal(await page.$eval("html", root => root.hasAttribute("data-bsp-active")), false);
    await page.click("#home button");
    await page.waitForSelector('html[data-bsp-column-mode="double"] #content_left > [data-bsp-result]', { timeout: 4000 });
    assert.equal(page.url(), "https://www.baidu.com/s?wd=example");
    assert.equal(await page.evaluate(() => performance.getEntriesByType("navigation")[0].name), "https://www.baidu.com/?from=fixture");
    await page.evaluate(() => history.pushState({}, "", "/s?wd=next"));
    await page.waitForFunction(() => document.documentElement.dataset.bspReady === "1");
    await page.$eval("#container", container => {
      container.outerHTML = `<div id="container"><div id="content_left">
        <div class="result c-container"><h3><a href="https://example.com/one">One</a></h3></div>
        <div class="result c-container"><h3><a href="https://example.com/two">Two</a></h3></div>
      </div></div>`;
    });
    await page.waitForFunction(() => document.querySelectorAll("#content_left > [data-bsp-result]").length === 2);
    const [first, second] = await page.$$eval("#content_left > [data-bsp-result]", cards => cards.map(card => card.getBoundingClientRect().left));
    assert.ok(first < second);
  } finally {
    await browser.close();
  }
});

test("Baidu centers the search box, menu, filters, and result cards", async () => {
  const executablePath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].find(existsSync);
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setContent(`<!doctype html><style>
      body { margin: 0; }
      #head { position: relative; height: 48px; }
      #result_logo, #u { position: absolute; top: 0; width: 52px; height: 40px; }
      #result_logo { left: 12px; }
      #u { right: 12px; }
      #form { margin-left: 120px; width: 550px; height: 40px; }
      #form.virtual-form { display: none; }
      #chat-input-main { position: absolute; top: 8px; left: 100px; width: 550px; height: 40px; }
      .s_ipt_wr, #kw { width: 470px; }
      #s_tab { width: 620px; overflow: hidden; }
      #s_tab_inner, #container { margin-left: 120px; }
      #s_tab_inner { display: flex; gap: 12px; width: 550px; }
      #container { width: 900px; }
      #content_left { width: 550px; }
      [tpl="new_baikan_index"] { width: 530px; margin-left: 20px; }
      #content_right { float: right; width: 260px; }
    </style>
    <div id="wrapper"><div id="head"><a id="result_logo">Baidu</a>
      <form id="form"><span class="s_ipt_wr"><input id="kw" name="wd" value="example"></span><button>Search</button></form>
      <div id="u">Account</div></div>
      <div tpl="app/head-tab"><div id="s_tab"><nav id="s_tab_inner">
        <a>Web</a><a>Images</a><a>News</a><span class="s-tab-filter">Search tools</span>
      </nav></div></div>
      <div id="container"><aside id="content_right"><div tpl="recommend_list_san">Related</div><div>Trending</div></aside><div id="content_left">
        <div tpl="app/search-tool"><button>Filters</button></div>
        <div class="result c-container" tpl="new_baikan_index"><h3><a href="https://example.com/citation">AI answer</a></h3></div>
        <div id="first" class="result c-container" mu="https://example.com/one"><h3><a href="https://example.com/one">One</a></h3></div>
        <div id="second" class="result c-container"><h3><a href="https://example.com/two">Two</a></h3></div>
        <div tpl="recommend_list">People also search</div>
      </div></div>
      <div tpl="app/rs"><div class="rs_new">Related searches</div></div>
      <div tpl="app/page"><div class="page"><a class="n" href="?wd=example&pn=10">Next</a></div></div>
    </div>`);
    await page.addStyleTag({ content: readFileSync(new URL("../extension/content.css", import.meta.url), "utf8") });
    const bundle = await build({
      entryPoints: ["src/boot.mjs"], bundle: true, write: false, format: "iife", globalName: "SearchLayout",
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async () => {
      window.baiduLayout = await SearchLayout.bootSearchPage(document, "https://www.baidu.com/s?wd=example", {},
        { prefs: { columnMode: "double", autoPage: false } });
    });
    const geometry = () => page.evaluate(() => {
      const box = selector => {
        const { left, right, top, bottom, width } = document.querySelector(selector).getBoundingClientRect();
        return { left, right, top, bottom, width, center: (left + right) / 2 };
      };
      const firstTab = box("#s_tab_inner a:first-child");
      const lastTab = box("#s_tab_inner a:last-of-type");
      return { results: box("#content_left"), first: box("#first"), second: box("#second"), search: box("#form"),
        filters: box('[tpl="app/search-tool"]'), sidebar: box("#content_right"), overview: box('[tpl="new_baikan_index"]'),
        tabsCenter: (firstTab.left + lastTab.right) / 2, viewport: document.documentElement.clientWidth,
        autoPage: baiduLayout.session.autoPage };
    });
    const desktop = await geometry();
    assert.equal(desktop.autoPage, false);
    assert.equal(desktop.results.width, 1320);
    assert.equal(desktop.results.center, desktop.viewport / 2);
    assert.ok(Math.abs(desktop.overview.center - desktop.results.center) < 1);
    assert.ok(desktop.overview.bottom <= desktop.first.top);
    assert.equal(await page.$('[tpl="new_baikan_index"][data-bsp-result]'), null);
    assert.equal(desktop.search.center, desktop.results.center);
    assert.ok(Math.abs(desktop.tabsCenter - desktop.results.center) < 1);
    assert.equal(await page.$eval("#s_tab_inner a:last-of-type", link => {
      const { x, y, width, height } = link.getBoundingClientRect();
      return link.contains(document.elementFromPoint(x + width / 2, y + height / 2));
    }), true);
    assert.equal(desktop.filters.left, desktop.results.left);
    assert.equal(await page.$eval("#s_tab_inner", nav => {
      const [first, second] = [...nav.querySelectorAll("a")].map(a => a.getBoundingClientRect());
      return second.left - first.right >= 10;
    }), true);
    assert.equal(await page.$$eval('[tpl="app/rs"], [tpl="recommend_list"], [tpl="recommend_list_san"]',
      modules => modules.every(module => getComputedStyle(module).display === "none")), true);
    assert.equal(await page.$eval("#content_right > div:last-child", widget => widget.checkVisibility()), true);
    assert.ok(desktop.first.left < desktop.second.left);
    assert.ok(desktop.sidebar.top >= desktop.results.bottom);

    await page.setViewport({ width: 390, height: 900 });
    await page.waitForFunction(() => Math.abs(document.querySelector("#content_left").getBoundingClientRect().left - 12) < 1);
    const narrow = await geometry();
    assert.equal(narrow.first.left, narrow.second.left);
    assert.ok(Math.abs(narrow.search.center - narrow.results.center) < 1);
    assert.ok(Math.abs(narrow.tabsCenter - narrow.results.center) < 1);
    assert.ok(narrow.results.right <= narrow.viewport);
    assert.ok(Math.abs(narrow.overview.center - narrow.results.center) < 1);
    assert.ok(narrow.overview.left >= 0 && narrow.overview.right <= narrow.viewport);

    await page.evaluate(() => baiduLayout.applyPrefs({ columnMode: "single-center", autoPage: false }));
    const narrowSingle = await geometry();
    assert.ok(Math.abs(narrowSingle.overview.center - narrowSingle.viewport / 2) < 1);
    assert.ok(narrowSingle.overview.left >= 0 && narrowSingle.overview.right <= narrowSingle.viewport);

    await page.setViewport({ width: 1440, height: 900 });
    for (const [mode, width] of [["single-center", 1100], ["single", 550], ["original", 550]]) {
      await page.evaluate(columnMode => baiduLayout.applyPrefs({ columnMode, autoPage: false }), mode);
      const current = await geometry();
      assert.equal(current.results.width, width);
      if (mode === "single-center") {
        assert.equal(current.search.center, current.results.center);
        assert.ok(Math.abs(current.overview.center - current.viewport / 2) < 1);
      }
    }
    assert.equal((await geometry()).search.left, 120);
    assert.equal((await geometry()).overview.left, 140);
    assert.equal(await page.$("[data-bsp-overview]"), null);
    assert.equal(await page.$eval('[tpl="app/rs"]', module => module.checkVisibility()), true);

    await page.evaluate(() => {
      document.getElementById("form").classList.add("virtual-form");
      document.getElementById("head").insertAdjacentHTML("afterbegin",
        '<div id="chat-input-main"><textarea id="chat-textarea">example</textarea></div>');
      delete document.documentElement.dataset.bspReady;
      baiduLayout.applyPrefs({ columnMode: "double", autoPage: false });
      document.documentElement.dataset.bspReady = "1";
    });
    const modernSearch = () => page.$eval("#chat-input-main", field => {
      const { left, width, bottom } = field.getBoundingClientRect();
      return { center: left + width / 2, bottom, legacyHidden: getComputedStyle(document.getElementById("form")).display === "none" };
    });
    assert.equal((await modernSearch()).legacyHidden, true);
    assert.ok(Math.abs((await modernSearch()).center - 720) < 1);

    await page.setViewport({ width: 390, height: 900 });
    await page.waitForFunction(() => {
      const field = document.getElementById("chat-input-main").getBoundingClientRect();
      return Math.abs(field.left + field.width / 2 - document.documentElement.clientWidth / 2) < 1;
    });
    assert.ok((await modernSearch()).bottom <= (await geometry()).results.top);

    await page.addStyleTag({ content: "#content_left > .result { min-height: 700px; }" });
    await page.evaluate(() => {
      window.pageRequests = [];
      window.fetch = async url => {
        pageRequests.push(new URL(url).searchParams.get("pn"));
        return new Response(`<div id="content_left">
          <div class="result c-container" mu="https://example.com/one"><h3><a href="/link?new-token">Duplicate</a></h3></div>
          <div id="first" class="result c-container"><h3><a href="https://example.com/three">Three</a></h3></div>
          <div tpl="recommend_list">Do not append</div>
        </div><div tpl="app/page"><a class="n" href="?wd=example&pn=20">Next</a></div>`);
      };
      baiduLayout.applyPrefs({ columnMode: "double", autoPage: true, pagesPerBatch: 1, nearBottomPx: 0 });
    });
    assert.deepEqual(await page.evaluate(() => pageRequests), []);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => baiduLayout.pager.stopped && baiduLayout.session.appendedPages === 1);
    assert.deepEqual(await page.evaluate(() => pageRequests), ["10"]);
    assert.deepEqual(await page.$$eval("#content_left > [data-bsp-result]", cards => cards.map(card => card.textContent.trim())), ["One", "Two", "Three"]);
    assert.equal(await page.$$eval("#first", cards => cards.length), 1);
    assert.equal(await page.$eval('[tpl="app/page"] a', link => new URL(link.href, "https://www.baidu.com/s").searchParams.get("pn")), "10");
  } finally {
    await browser.close();
  }
});
