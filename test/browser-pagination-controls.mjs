import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

test("auto-page hides native pagination while keeping its own controls usable on all engines", async () => {
  const executablePath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].find(existsSync);
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ["--no-sandbox"] });
  try {
    const css = readFileSync(new URL("../extension/content.css", import.meta.url), "utf8");
    const bundle = await build({
      entryPoints: ["src/boot.mjs"], bundle: true, write: false, format: "iife", globalName: "SearchLayout",
    });
    const fixtures = [
      ["https://www.google.com/search?q=test", "#navcnt",
        '<div id="rso"></div><div id="botstuff"><div id="other">Related</div><div id="navcnt"><table><tr><td><a id="pnnext" href="/search?q=test&start=10">Next</a></td></tr></table></div></div>'],
      ["https://www.bing.com/search?q=test", ".b_pag",
        '<ol id="b_results"><li class="b_pag"><a class="sb_pagN" href="/search?q=test&first=11">Next</a></li></ol>'],
      ["https://www.baidu.com/s?wd=test", '[tpl="app/page"]',
        '<div id="content_left"></div><div tpl="app/page"><div id="page"><a class="n" href="/s?wd=test&pn=10">Next</a></div></div>'],
      ["https://duckduckgo.com/?q=test", "#more-results",
        '<div id="web_content_wrapper"><ol class="react-results--main"><li id="divider"><div class="k0dqcyn_SZAmh1pFFuQ5">Page 2</div></li></ol><div class="rdxznaZygY2CryNa5yzk"><button id="more-results">More results</button></div></div>'],
    ];
    for (const [url, selector, markup] of fixtures) {
      const page = await browser.newPage();
      try {
        await page.setContent(`<!doctype html>${markup}<footer id="footer">Help</footer>`);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const result = await page.evaluate(async url => {
          const nativeButton = document.getElementById("more-results");
          nativeButton?.addEventListener("click", () => {
            document.querySelector(".react-results--main").insertAdjacentHTML("beforeend",
              '<li data-layout="organic"><a data-testid="result-title-a" href="https://example.com/2">Result</a></li>');
          });
          window.searchLayout = await SearchLayout.bootSearchPage(document, url, {}, {
            prefs: { columnMode: "original", autoPage: true, pagesPerBatch: 1 },
            attachScroll: false,
            fetchDocument: async () => { throw new Error("Offline"); },
          });
          return searchLayout.pager.check({ viewportHeight: 900, listBottom: 800 });
        }, url);
        const visible = selector => page.$eval(selector, element => element.checkVisibility({ visibilityProperty: true }));
        const duck = selector === "#more-results";
        assert.equal(result.fetched, duck, url);
        assert.equal(await visible(selector), false, url);
        assert.equal(await visible("#bsp-status button"), true, url);
        assert.equal(await visible("#footer"), true, url);
        if (selector === "#navcnt") assert.equal(await visible("#other"), true);
        if (duck) {
          assert.equal(await visible("#divider"), false);
          const resumed = await page.evaluate(async () => {
            const button = document.getElementById("more-results");
            button.disabled = true;
            try {
              return await searchLayout.pager.continueLoading();
            } finally {
              button.disabled = false;
            }
          });
          assert.equal(resumed.fetched, false);
          assert.equal(await visible("#bsp-status button"), true);
        }
        await page.evaluate(() => searchLayout.applyPrefs({ columnMode: "original", autoPage: false }));
        assert.equal(await visible(selector), true, url);
        assert.equal(await visible("#bsp-status"), false, url);
        if (duck) assert.equal(await visible("#divider"), true);
        await page.evaluate(() => {
          searchLayout.applyPrefs({ columnMode: "original", autoPage: true });
          searchLayout.dispose();
        });
        assert.equal(await visible(selector), true, url);
      } finally {
        await page.close();
      }
    }

    const page = await browser.newPage();
    await page.setContent('<div id="rso"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const imported = await page.evaluate(async () => {
      const boot = await SearchLayout.bootSearchPage(document, "https://www.google.com/search?q=test", {}, {
        prefs: { columnMode: "original", autoPage: true }, attachScroll: false, watchDom: false,
        fetchDocument: async () => new DOMParser().parseFromString(`<div id="rso">
          <div class="g" onclick="window.importedHandler = true"><h3><a href="https://example.org/">Result</a></h3>
            <img src="data:image/png;base64,broken" onerror="window.importedHandler = true">
            <a href="java&#x09;script:window.importedHandler = true">Unsafe</a>
            <iframe srcdoc="<script>parent.importedHandler = true</script>"></iframe>
          </div>
          <div class="g"><h3><a href="javascript:alert(1)">Unsafe result</a></h3></div>
        </div>`, "text/html"),
      });
      const { added } = await boot.pager.check({ viewportHeight: 900, listBottom: 800 });
      const card = document.querySelector("#rso .g");
      card.click();
      card.querySelector("img").dispatchEvent(new Event("error"));
      return { added, href: card.querySelector("h3 a").href, links: card.querySelectorAll("a[href]").length,
        imageKept: card.querySelector("img").hasAttribute("src"), embeds: card.querySelectorAll("iframe").length,
        ranHandler: window.importedHandler === true };
    });
    assert.deepEqual(imported, { added: 1, href: "https://example.org/", links: 1, imageKept: true, embeds: 0, ranHandler: false });
  } finally {
    await browser.close();
  }
});
