import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import puppeteer from "puppeteer-core";
import { searchPage } from "./fixtures/search-page.mjs";

test("Chromium installed extension: background / foreground tabs, current tab, pinned queries and site badges", async () => {
  const executablePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, enableExtensions: true,
    args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [] });
  try {
    const id = await browser.installExtension(resolve("extension"));
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.select('[name="resultOpenMode"]', "background");
    await popup.evaluate(async () => {
      for (const name of ["pinRelated", "emphasizeSite", "dimVisited"]) document.querySelector(`[name="${name}"]`).checked = true;
      document.querySelector('[name="autoPage"]').checked = false;
      document.querySelector('[name="pinRelated"]').dispatchEvent(new Event("change", { bubbles: true }));
    });
    await popup.waitForFunction(async () => {
      const { prefs } = await chrome.storage.sync.get("prefs");
      return prefs?.resultOpenMode === "background" && prefs.pinRelated && prefs.emphasizeSite && prefs.dimVisited && !prefs.autoPage;
    });
    const errors = [];
    for (const engine of ["google", "bing"]) {
      const page = await browser.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.setRequestInterception(true);
      const origin = `https://www.${engine}.com`;
      const markup = searchPage({ engine }).replaceAll("https://example.com/result/", `${origin}/destination-fixture/`)
        .replace("</body>", `<div ${engine === "google" ? 'id="bres"' : 'class="b_rs"'}>${Array.from({ length: 10 }, (_, i) => `<a href="/search?q=related${i}">Related query ${i}</a>`).join("")}</div></body>`);
      page.on("request", request => {
        if (request.isNavigationRequest()) void request.respond({ status: 200, contentType: "text/html", body: request.url().includes("/search?") ? markup : "<html><body>Destination fixture</body></html>" });
        else void request.abort();
      });
      await page.setViewport({ width: 1440, height: 900 });
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
      await page.goto(`${origin}/search?q=test`);
      await page.waitForSelector(".bsp-site-badge");
      assert.equal(await page.$eval(".bsp-site-domain", el => el.textContent), `www.${engine}.com`);
      assert.equal(await page.$eval("#bsp-related", el => getComputedStyle(el).position), "fixed");
      await page.setViewport({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      const bounds = await page.$eval("#bsp-related", el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, scrollable: el.scrollWidth > el.clientWidth }));
      assert.ok(bounds.left >= 0 && bounds.right <= 390 && bounds.scrollable);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      assert.ok(await page.$eval("#bsp-related", el => el.getBoundingClientRect().bottom <= innerHeight));
      await page.setViewport({ width: 1440, height: 900 });
      const title = engine === "google" ? "#bsp-results h3 a" : "#bsp-results h2 a";
      for (const mode of ["background", "new-tab"]) {
        await popup.evaluate(mode => chrome.storage.sync.set({ prefs: { resultOpenMode: mode, autoPage: false, emphasizeSite: true, pinRelated: mode === "background", dimVisited: true } }), mode);
        await page.bringToFront();
        await page.waitForFunction(show => Boolean(document.getElementById("bsp-related")) === show, { polling: 100 }, mode === "background");
        const source = await popup.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
        const targetPromise = browser.waitForTarget(target => target.type() === "page" && target.url().startsWith(`${origin}/destination-fixture/`));
        const index = mode === "background" ? 0 : 1;
        await (await page.$$(title))[index].click();
        const target = await targetPromise;
        await popup.waitForFunction(async ({ source, active }) => ((await chrome.tabs.query({ active: true, currentWindow: true }))[0].id === source) === active,
          { polling: 100 }, { source, active: mode === "background" });
        const opened = await target.page();
        await opened.close();
        await page.bringToFront();
        await page.waitForFunction(({ title, index }) => document.querySelectorAll(title)[index].getAttribute("data-bsp-opened") === "true", { polling: 100 }, { title, index });
        assert.equal(await page.$$eval(title, (links, index) => getComputedStyle(links[index]).color, index), "rgb(115, 115, 135)");
        assert.equal(await page.$(".bsp-open-error"), null);
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(".bsp-site-badge");
      assert.equal(await page.$("[data-bsp-opened]"), null);
      await popup.evaluate(() => chrome.storage.sync.set({ prefs: { resultOpenMode: "current", autoPage: false, emphasizeSite: false, pinRelated: false } }));
      await page.bringToFront();
      await page.waitForFunction(() => !document.querySelector(".bsp-site-badge"), { polling: 100 });
      const navigated = page.waitForNavigation({ waitUntil: "domcontentloaded" });
      await page.click(title); await navigated;
      assert.ok(page.url().startsWith(`${origin}/destination-fixture/`));
      await page.close();
      // Prepare the same settings for the second engine's initial page.
      await popup.evaluate(() => chrome.storage.sync.set({ prefs: { resultOpenMode: "background", autoPage: false, emphasizeSite: true, pinRelated: true, dimVisited: true } }));
    }
    await mkdir(".scratch", { recursive: true });
    await popup.evaluate(() => document.querySelector("#bsp-browsing-title").scrollIntoView());
    await popup.screenshot({ path: ".scratch/result-tools-popup.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
