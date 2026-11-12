import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

test("DuckDuckGo aligns results, search, tabs, and filters despite offset native rails", async () => {
  const executablePath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].find(existsSync);
  const browser = await puppeteer.launch({
    executablePath, headless: true, pipe: true, timeout: 10000,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setContent(`<!doctype html>
      <style>
        body { margin: 0; }
        header { position: relative; height: 54px; }
        #search_form { display: flex; width: 500px; max-width: 100%; height: 42px; }
        #search_form input { flex: 1; min-width: 0; }
        .header__search-wrap { position: absolute; left: 190px; width: 510px; overflow: hidden; }
        .header__logo-wrap { position: absolute; left: 20px; width: 70px; height: 42px; }
        .header--aside { position: absolute; right: 20px; width: 105px; height: 42px; }
        #react-duckbar { margin-left: 90px; width: 660px; overflow: hidden; }
        #react-duckbar nav { display: flex; justify-content: space-between; padding: 0 12px; max-width: 620px; }
        #react-duckbar ul { display: flex; list-style: none; margin: 0; }
        .native-filters { margin-left: 115px; }
        .native-filters nav { max-width: 600px; padding-left: 12px; }
        #web_content_wrapper { margin-left: 190px; }
        .native-rail { width: 550px; max-width: 100%; margin-left: 145px; overflow: hidden; }
        .react-results--main { max-width: 530px; }
        [data-react-module-id="wikinlp"] { width: 500px; }
      </style>
      <header id="header_wrapper">
        <a class="header__logo-wrap">Logo</a>
        <div class="header__search-wrap"><form id="search_form"><input id="search_form_input" name="q"></form></div>
        <div class="header--aside">Settings</div>
      </header>
      <div id="react-duckbar"><nav>
        <ul><li><a href="?q=example">All</a></li><li><a href="?q=example&ia=images">Images</a></li></ul>
        <ul><li><button>Settings</button></li></ul>
      </nav></div>
      <div id="web_content_wrapper"><div class="native-rail"><div id="react-layout"><div><div>
        <div class="native-filters"><nav>
          <button data-testid="privacy-reminder">Privacy</button><button>Region</button>
          <button>Safe Search</button><button data-testid="date-filter-trigger">Any time</button>
        </nav></div>
        <section data-testid="mainline">
          <div class="react-module" data-react-module-id="wikinlp"><button>Search Assist</button></div>
          <ol class="react-results--main">
            <li data-layout="organic"><a data-testid="result-title-a" href="https://example.com/one">One</a></li>
            <li data-layout="organic"><a data-testid="result-title-a" href="https://example.com/two">Two</a></li>
          </ol>
        </section>
      </div></div></div></div></div>`);
    await page.addStyleTag({ content: readFileSync(new URL("../extension/content.css", import.meta.url), "utf8") });
    const bundle = await build({
      stdin: { contents: 'export { bootSearchPage } from "./src/boot.mjs";', resolveDir: process.cwd() },
      bundle: true, write: false, format: "iife", globalName: "SearchLayout",
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async () => {
      window.duckLayout = await SearchLayout.bootSearchPage(document, "https://duckduckgo.com/?q=example", {},
        { prefs: { columnMode: "double", autoPage: false }, attachScroll: false });
    });

    const geometry = () => page.evaluate(() => {
      const rect = selector => {
        const { left, right, width } = document.querySelector(selector).getBoundingClientRect();
        return { left, right, width, center: (left + right) / 2 };
      };
      return {
        list: rect(".react-results--main"), form: rect("#search_form"),
        overview: rect('[data-react-module-id="wikinlp"]'),
        logo: rect(".header__logo-wrap"), menu: rect(".header--aside"),
        tabs: rect("#react-duckbar nav"), primaryTabs: rect("#react-duckbar nav ul:first-of-type"),
        tabActions: rect("#react-duckbar nav ul:last-of-type"),
        filters: rect(".native-filters nav"), firstFilter: rect("[data-testid='privacy-reminder']"),
        first: rect(".react-results--main li:first-child"), second: rect(".react-results--main li:last-child"),
        viewportWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    const desktop = await geometry();
    assert.equal(desktop.list.width, 1320);
    assert.ok(Math.abs(desktop.list.center - desktop.viewportWidth / 2) < 1);
    assert.ok(Math.abs(desktop.overview.center - desktop.list.center) < 1);
    assert.equal(desktop.overview.width, 500);
    assert.ok(Math.abs(desktop.form.center - desktop.list.center) < 1);
    assert.ok(desktop.form.left > desktop.logo.right && desktop.form.right < desktop.menu.left);
    assert.deepEqual(desktop.tabs, desktop.list);
    assert.deepEqual(desktop.filters, desktop.list);
    assert.ok(Math.abs(desktop.primaryTabs.center - desktop.list.center) < 1);
    assert.ok(desktop.tabActions.left > desktop.primaryTabs.right);
    assert.equal(desktop.tabActions.right, desktop.list.right);
    assert.equal(desktop.firstFilter.left, desktop.list.left);
    assert.ok(desktop.second.left > desktop.first.left);
    assert.equal(desktop.scrollWidth, desktop.viewportWidth);
    assert.equal(await page.$eval(".react-results--main > li:last-child", card => {
      const { right, top } = card.getBoundingClientRect();
      return card.contains(document.elementFromPoint(right - 8, top + 8));
    }), true);

    await page.setViewport({ width: 390, height: 800 });
    await page.waitForFunction(() => {
      const { left, right } = document.querySelector(".react-results--main").getBoundingClientRect();
      return Math.abs(left + right - document.documentElement.clientWidth) < 2;
    });
    const narrow = await geometry();
    assert.equal(narrow.first.left, narrow.second.left);
    assert.ok(narrow.list.left > 0 && narrow.list.right < narrow.viewportWidth);
    assert.ok(Math.abs(narrow.overview.center - narrow.list.center) < 1);
    assert.ok(narrow.overview.left >= 0 && narrow.overview.right <= narrow.viewportWidth);
    assert.deepEqual(narrow.tabs, narrow.list);
    assert.deepEqual(narrow.filters, narrow.list);
    assert.ok(Math.abs(narrow.primaryTabs.center - narrow.list.center) < 1);
    assert.ok(narrow.tabActions.left > narrow.primaryTabs.right);

    await page.evaluate(() => duckLayout.applyPrefs({ columnMode: "single-center", autoPage: false }));
    const narrowSingle = await geometry();
    assert.ok(Math.abs(narrowSingle.overview.center - narrowSingle.viewportWidth / 2) < 1);
    assert.ok(narrowSingle.overview.left >= 0 && narrowSingle.overview.right <= narrowSingle.viewportWidth);

    await page.setViewport({ width: 1440, height: 900 });
    await page.waitForFunction(() => {
      const { left, right } = document.querySelector(".react-results--main").getBoundingClientRect();
      return Math.abs(left + right - document.documentElement.clientWidth) < 2;
    });
    const single = await geometry();
    assert.equal(single.list.width, 1100);
    assert.ok(Math.abs(single.list.center - single.form.center) < 1);
    assert.ok(Math.abs(single.overview.center - single.viewportWidth / 2) < 1);
    assert.deepEqual(single.tabs, single.list);
    assert.ok(Math.abs(single.primaryTabs.center - single.list.center) < 1);
    assert.deepEqual(single.filters, single.list);

    await page.evaluate(() => duckLayout.applyPrefs({ columnMode: "original", autoPage: false }));
    const original = await geometry();
    assert.equal(original.form.left, 190);
    assert.equal(original.form.width, 500);
    assert.equal(original.list.width, 550);
    assert.equal(original.tabs.left, 90);
    assert.equal(original.filters.left, 450);
    assert.equal(original.overview.left, 335);
    assert.equal(await page.$("[data-bsp-overview]"), null);

    await page.evaluate(() => {
      document.querySelector(".react-results--main").remove();
      duckLayout.applyPrefs({ columnMode: "double", autoPage: false });
    });
    assert.deepEqual(await page.$eval(".native-filters nav", bar => {
      const { left, width } = bar.getBoundingClientRect();
      return { left, width };
    }), { left: 60, width: 1320 });
    assert.ok(Math.abs(await page.$eval("#search_form", form => {
      const { left, width } = form.getBoundingClientRect();
      return left + width / 2 - document.documentElement.clientWidth / 2;
    })) < 1);
  } finally {
    await browser.close();
  }
});
