import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import puppeteer from "puppeteer-core";
import esbuild from "esbuild";
import { searchPage, resultMarkup } from "./fixtures/search-page.mjs";

test("Chromium：四组设置、可恢复广告、侧栏预算、自动继续与真实弹窗", async () => {
  const executablePath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(existsSync);
  const browser = await puppeteer.launch({ executablePath, headless: true, timeout: 15000,
    args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    const bundle = await esbuild.build({ stdin: { contents: 'export { bootSearchPage } from "./src/boot.mjs";', resolveDir: process.cwd() },
      bundle: true, write: false, format: "iife", globalName: "Controls" });
    const css = await readFile("extension/content.css", "utf8");
    for (const engine of ["google", "bing"]) {
      await page.setContent(searchPage({ engine, ai: true }));
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const state = await page.evaluate(async ({ engine, fresh }) => {
        const ad = document.createElement(engine === "bing" ? "li" : "div");
        if (engine === "bing") { ad.className = "b_ad"; document.querySelector("#b_results").prepend(ad); }
        else { ad.id = "tads"; document.querySelector("#center_col").prepend(ad); }
        ad.innerHTML = '<a href="https://example.com/ad">Ad content</a>';
        window.controlsAd = ad.firstChild;
        window.controlsRequests = 0;
        window.controlsBoot = await Controls.bootSearchPage(document, `https://www.${engine}.com/search?q=test`, {}, {
          attachScroll: false, watchDom: false,
          prefs: { columnMode: "double", autoPage: false, cardDensity: "compact", maxColumnWidth: 520,
            googleSidebar: false, bingSidebar: true, showAI: false, adsMode: "collapse" },
          fetchDocument: async () => {
            const n = ++window.controlsRequests;
            return new DOMParser().parseFromString(engine === "bing"
              ? `<ol id="b_results">${n <= 3 ? fresh[n - 1] : ""}</ol>`
              : `<div id="rso">${n <= 3 ? fresh[n - 1] : ""}</div>`, "text/html");
          },
        });
        const box = document.querySelector("#bsp-results");
        return { gap: getComputedStyle(box).rowGap, padding: getComputedStyle(box.firstElementChild).paddingTop,
          cardWidth: box.firstElementChild.getBoundingClientRect().width,
          ai: getComputedStyle(document.querySelector("#ai-overview")).display,
          sidebar: getComputedStyle(document.querySelector(engine === "bing" ? "#b_context" : "#rhs")).display,
          fold: !!controlsAd.closest("details"), overflow: document.documentElement.scrollWidth > innerWidth + 2 };
      }, { engine, fresh: [101, 102, 103].map(n => resultMarkup(engine, n)) });
      assert.equal(state.gap, "12px");
      assert.equal(state.padding, "10px");
      assert.ok(state.cardWidth <= 521);
      assert.equal(state.ai, "none");
      assert.equal(state.sidebar === "none", engine === "google");
      assert.equal(state.fold, true);
      assert.equal(state.overflow, false);
      await page.setViewport({ width: 390, height: 844 });
      await page.waitForFunction(() => Number(document.documentElement.dataset.bspShellWidth) <= 326);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      if (engine === "bing") {
        assert.ok(await page.$eval("#b_context", el => el.getBoundingClientRect().right) <= 390);
      }
      await page.setViewport({ width: 1440, height: 1000 });
      await page.waitForFunction(() => Number(document.documentElement.dataset.bspShellWidth) > 800);
      await page.click(".bsp-ad-fold > summary");
      assert.equal(await page.$eval(".bsp-ad-fold", el => el.open), true);
      await page.mouse.move(1430, 990);
      const restored = await page.evaluate(() => {
        controlsBoot.applyPrefs({ columnMode: "double", autoPage: false, cardDensity: "relaxed", maxColumnWidth: 520,
          googleSidebar: true, bingSidebar: false, showAI: true, adsMode: "dim" });
        return { sameNode: document.querySelector("[data-bsp-ad-region] > a") === controlsAd,
          opacity: getComputedStyle(controlsAd.parentElement).opacity,
          gap: getComputedStyle(document.querySelector("#bsp-results")).rowGap,
          ai: getComputedStyle(document.querySelector("#ai-overview")).display };
      });
      assert.equal(restored.sameNode, true);
      assert.equal(restored.opacity, "0.45");
      assert.equal(restored.gap, "30px");
      assert.notEqual(restored.ai, "none");
      await page.evaluate(() => controlsBoot.applyPrefs({ autoPage: true, autoContinue: true, pagesPerBatch: 1, nearBottomPx: 3000 }));
      await page.waitForFunction(() => controlsBoot.session.appendedPages === 3 && controlsBoot.pager.stopped);
      assert.equal(await page.evaluate(() => controlsRequests), 4);
      await page.evaluate(() => controlsBoot.dispose());
      assert.equal(await page.$("[data-bsp-density], .bsp-ad-fold, [data-bsp-ad-region]"), null);
    }

    const popupHtml = (await readFile("extension/popup.html", "utf8")).replace('<script src="popup.js"></script>', "");
    await page.setViewport({ width: 360, height: 600 });
    await page.setContent(popupHtml);
    await page.addStyleTag({ content: await readFile("extension/popup.css", "utf8") });
    await page.evaluate(() => {
      window.controlsStored = {};
      window.chrome = { storage: { sync: {
        get: async key => ({ [key]: controlsStored[key] }),
        set: async next => { Object.assign(controlsStored, next); },
      } } };
    });
    const popup = await esbuild.build({ entryPoints: ["src/popup.mjs"], bundle: true, write: false, format: "iife" });
    await page.addScriptTag({ content: popup.outputFiles[0].text });
    await page.waitForFunction(() => document.querySelector("[name='pagesPerBatch']").value === "10");
    await page.select("[name='cardDensity']", "compact");
    await page.evaluate(() => {
      const input = document.querySelector("[name='maxColumnWidth']");
      input.value = "540";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => controlsStored.prefs?.maxColumnWidth === 540);
    assert.equal(await page.evaluate(() => controlsStored.prefs.cardDensity), "compact");
    await page.click("[data-locale='zh']");
    await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
    await page.evaluate(() => document.querySelectorAll("details").forEach(el => { el.open = true; }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await mkdir(".scratch", { recursive: true });
    await page.screenshot({ path: ".scratch/reading-controls-popup.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
