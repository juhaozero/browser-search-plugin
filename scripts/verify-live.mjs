import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import esbuild from "esbuild";
import { resolve } from "node:path";

const executablePath = process.env.CHROME_PATH ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(existsSync);
const bundle = await esbuild.build({ stdin: {
  contents: 'export { bootSearchPage } from "./src/content-boot.mjs"; export { fetchHtmlDocument } from "./src/auto-page.mjs";',
  resolveDir: process.cwd(),
}, bundle: true, write: false, format: "iife", globalName: "SearchLayoutLive" });
const css = await readFile("extension/content.css", "utf8");
await mkdir(".scratch/live", { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true, timeout: 20000, pipe: true, enableExtensions: true,
  args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [],
});
const report = [];
try {
  for (const engine of (process.env.LIVE_PACKAGED_ONLY ? [] : process.env.LIVE_ENGINE ? [process.env.LIVE_ENGINE] : ["google", "bing"])) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const entry = { engine, checks: [] };
    entry.navigations = [];
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) entry.navigations.push(frame.url()); });
    try {
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(`https://www.${engine}.com/search?q=chromium+documentation${engine === "bing" ? "&rdr=1" : ""}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Bing 首次访问可能整页跳转到区域站点；等站点导航稳定后再注入待测代码。
      await page.waitForNetworkIdle({ idleTime: 1000, timeout: 8000 }).catch(() => {});
      entry.url = page.url();
      await page.waitForSelector(engine === "google" ? "#rso h3" : "#b_results > li.b_algo h2", { timeout: 12000 });
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const initial = await page.evaluate(async () => {
        window.liveBoot = await SearchLayoutLive.bootSearchPage(document, location.href, {}, {
          prefs: { columnMode: "single-center", autoPage: false }, attachScroll: false,
          fetchDocument: async (url, signal) => {
            (window.liveRequests ??= []).push(url);
            if (window.failNextPage) { window.failNextPage = false; throw new Error("Simulated offline"); }
            const doc = await SearchLayoutLive.fetchHtmlDocument(url, signal);
            window.liveFetchedSummary = { title: doc.title,
              organic: doc.querySelectorAll("#rso .g, #rso .tF2Cxc, #b_results > li.b_algo").length,
              headings: [...doc.querySelectorAll("#rso h3, #b_results h2")].slice(0, 3).map(el => el.textContent),
              text: doc.querySelector("#b_results, #rso, #search")?.textContent.slice(0, 600),
            };
            return doc;
          },
        });
        return document.querySelector("#bsp-results")?.children.length ?? 0;
      });
      assert.ok(initial > 0, "Live results must be recognized");
      entry.initialResults = initial;
      for (const mode of ["double", "single", "original", "single-center"]) {
        const result = await page.evaluate(mode => {
          liveBoot.applyPrefs({ columnMode: mode, autoPage: false });
          const box = document.querySelector("#bsp-results");
          return { mode: box?.dataset.mode ?? "original", overflow: document.documentElement.scrollWidth > innerWidth + 2 };
        }, mode);
        assert.equal(result.mode, mode);
        assert.equal(result.overflow, false, `Horizontal overflow in ${mode}`);
        entry.checks.push(`layout:${mode}`);
      }
      await page.evaluate(async () => {
        liveBoot.applyPrefs({ columnMode: "single-center", autoPage: true });
        window.failNextPage = true;
        await liveBoot.pager.check({ scrollY: 0, viewportHeight: 1000, listBottom: 1000 });
      });
      assert.equal(await page.locator("#bsp-status button").filter(button => /Retry|重试/.test(button.textContent)).wait().then(() => true), true);
      await page.locator("#bsp-status button").filter(button => /Retry|重试/.test(button.textContent)).click();
      await page.waitForFunction(() => window.liveBoot && (liveBoot.session.appendedPages >= 1
        || liveBoot.pager.stopped || /加载失败|Could not load/.test(document.querySelector(".bsp-status-message")?.textContent ?? "")), { timeout: 20000 });
      const recovered = await page.evaluate(() => ({
        appended: liveBoot.session.appendedPages, results: document.querySelector("#bsp-results").children.length,
        status: document.querySelector(".bsp-status-message")?.textContent,
        requests: window.liveRequests, fetched: window.liveFetchedSummary,
      }));
      assert.ok(recovered.fetched, "Retry must fetch and parse a real search page");
      assert.equal(/加载失败|Could not load/.test(recovered.status), false);
      assert.equal(recovered.requests.length, 2, "One simulated failure followed by one real request");
      entry.pagination = recovered;
      if (recovered.appended === 0) {
        assert.equal(recovered.results, initial, "Repeated results must not be appended");
        entry.note = "The real next-page endpoint returned existing results; verified duplicate suppression and the no-new-results message. Appending fresh results remains unverified on this live response.";
        entry.checks.push("duplicate-suppression", "no-new-results-message");
      } else {
        assert.ok(recovered.results > initial);
        entry.checks.push("real-next-page-append");
      }
      entry.checks.push("real-next-page-request", "page-count", "failure-message", "retry-button");
      await page.evaluate(() => document.querySelector("#bsp-status").scrollIntoView());
      await page.screenshot({ path: `.scratch/live/${engine}.png` });
      await page.evaluate(() => liveBoot.dispose());
      assert.equal(await page.$("#bsp-status"), null);
      assert.deepEqual(errors, []);
      entry.checks.push("dispose", "no-page-errors");
      entry.passed = true;
    } catch (error) {
      entry.passed = false;
      entry.error = error.message;
      entry.url = page.url();
      entry.title = await page.title().catch(() => "");
      entry.state = await page.evaluate(() => ({ status: document.querySelector("#bsp-status")?.textContent,
        appended: window.liveBoot?.session.appendedPages, requests: window.liveRequests, fetched: window.liveFetchedSummary,
      })).catch(() => null);
      entry.pageErrors = errors;
      await page.evaluate(() => document.querySelector("#bsp-status")?.scrollIntoView()).catch(() => {});
      await page.screenshot({ path: `.scratch/live/${engine}-failure.png` }).catch(() => {});
    } finally {
      report.push(entry);
      await writeFile(`.scratch/live/${engine}-report.json`, JSON.stringify(entry, null, 2));
      console.log(JSON.stringify(entry));
      await page.close();
    }
  }
  // 在独立浏览器中加载实际构建产物，额外检查 isolated content script 与 storage 联动。
  const packaged = { engine: "bing", method: "installed-extension", checks: [] };
  const installedPage = await browser.newPage();
  try {
    const extensionId = await browser.installExtension(resolve("extension"));
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(() => chrome.storage.sync.set({ prefs: { columnMode: "single-center", autoPage: false } }));
    await installedPage.setViewport({ width: 1440, height: 1000 });
    await installedPage.goto("https://www.bing.com/search?q=chromium+documentation&rdr=1", { waitUntil: "domcontentloaded", timeout: 30000 });
    await installedPage.waitForSelector('#bsp-results[data-mode="single-center"]', { timeout: 15000 });
    assert.ok(await installedPage.$$eval("#bsp-results > li.b_algo", items => items.length) > 0);
    packaged.checks.push("content-script", "default-layout");
    let failRequest = true;
    await installedPage.setRequestInterception(true);
    installedPage.on("request", request => {
      const target = new URL(request.url());
      if (failRequest && target.hostname.endsWith("bing.com") && target.pathname === "/search" && target.searchParams.has("first")) {
        packaged.blockedRequests = (packaged.blockedRequests ?? 0) + 1;
        void request.abort("failed");
      } else void request.continue();
    });
    await popup.evaluate(() => chrome.storage.sync.set({ prefs: { columnMode: "double", autoPage: true } }));
    await installedPage.bringToFront();
    await installedPage.waitForSelector('#bsp-results[data-mode="double"]');
    packaged.checks.push("storage-live-layout");
    await installedPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await installedPage.waitForFunction(() => /重试|Retry/.test(document.querySelector("#bsp-status")?.textContent ?? ""), { polling: 100, timeout: 20000 });
    packaged.checks.push("scroll-triggered-failure");
    await installedPage.evaluate(() => { document.documentElement.lang = "en"; });
    await popup.evaluate(() => chrome.storage.sync.set({ uiLocale: "zh" }));
    await installedPage.waitForFunction(() => document.querySelector("#bsp-status button")?.textContent === "重试", { polling: 100 });
    await popup.evaluate(() => chrome.storage.sync.set({ uiLocale: "en" }));
    await installedPage.waitForFunction(() => document.querySelector("#bsp-status button")?.textContent === "Retry", { polling: 100 });
    assert.equal(await installedPage.evaluate(() => document.documentElement.lang), "en");
    packaged.checks.push("locale-live-status");
    failRequest = false;
    await installedPage.locator("#bsp-status button").filter(button => /Retry|重试/.test(button.textContent)).click();
    await installedPage.waitForFunction(() => /没有更多新结果|No more new results|已追加 [1-9]|Pages added: [1-9]/.test(document.querySelector("#bsp-status")?.textContent ?? ""), { polling: 100, timeout: 20000 });
    packaged.checks.push("retry-button-real-request");
    packaged.status = await installedPage.$eval("#bsp-status", el => el.textContent);
    await installedPage.screenshot({ path: ".scratch/live/bing-installed.png" });
    await popup.close();
    packaged.passed = true;
  } catch (error) {
    packaged.passed = false;
    packaged.error = error.message;
    packaged.state = await installedPage.evaluate(() => ({ url: location.href,
      status: document.querySelector("#bsp-status")?.textContent,
      scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight,
    })).catch(() => null);
  } finally {
    console.log(JSON.stringify(packaged));
    await writeFile(".scratch/live/extension-report.json", JSON.stringify(packaged, null, 2));
    report.push(packaged);
    await installedPage.close();
  }
} finally {
  await browser.close();
  await writeFile(".scratch/live/report.json", JSON.stringify(report, null, 2));
}
if (report.some(entry => !entry.passed)) process.exitCode = 1;
