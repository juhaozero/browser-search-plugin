import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

test("site badges stay compact and use the destination domain on all four engines", async () => {
  const executablePath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].find(existsSync);
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ["--no-sandbox"] });
  try {
    const css = readFileSync(new URL("../extension/content.css", import.meta.url), "utf8");
    const bundle = await build({ entryPoints: ["src/boot.mjs"], bundle: true, write: false, format: "iife", globalName: "SearchLayout" });
    const destination = "https://example.org/article";
    const icon = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const fixtures = [
      ["https://www.google.com/search?q=test", `<div id="rso"><div class="g"><img class="XNo5Ab" src="https://www.google.com/broken-fixture-icon.png"><a href="/url?q=${encodeURIComponent(destination)}"><h3>Result</h3></a></div></div>`],
      ["https://www.bing.com/search?q=test", `<ol id="b_results"><li class="b_algo"><div class="siteicon"><img width="32" src="${icon}"></div><h2><a href="/ck/a?u=a1${Buffer.from(destination).toString("base64url")}">Result</a></h2></li></ol>`, "b_dark"],
      ["https://www.baidu.com/s?wd=test", `<div id="content_left"><div class="result c-container" mu="https://example.org:444/article"><h3><a href="/link?url=redirect">Result</a></h3></div><div class="result c-container"><h3><a href="/link?url=unknown">Unknown target</a></h3></div></div>`, "darkmode"],
      ["https://duckduckgo.com/?q=test", `<ol class="react-results--main"><li data-layout="organic"><img src="https://external-content.duckduckgo.com/ip3/example.org.ico"><a data-testid="result-title-a" href="/l/?uddg=${encodeURIComponent(destination)}">Result</a></li></ol>`],
    ];
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setRequestInterception(true);
    const faviconUrl = "https://example.org/favicon.ico";
    const duckIcon = "https://external-content.duckduckgo.com/ip3/example.org.ico";
    page.on("request", request => {
      if (request.url() === duckIcon || request.url() === faviconUrl) {
        void request.respond({ contentType: "image/gif", headers: { "Cache-Control": "no-store" }, body: Buffer.from(icon.split(",")[1], "base64") });
      } else void request.abort();
    });
    for (const [url, markup, darkClass] of fixtures) {
      const failFallback = url.includes("baidu.com");
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: darkClass ? "light" : "dark" }]);
      await page.setContent(`<!doctype html><body class="${darkClass ?? ""}">${markup}</body>`);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const badge = await page.evaluate(async url => {
        window.badgeLayout = await SearchLayout.bootSearchPage(document, url, {}, {
          prefs: { columnMode: "double", autoPage: false, emphasizeSite: true }, attachScroll: false,
        });
        const icon = document.querySelector(".bsp-site-icon");
        const domain = document.querySelector(".bsp-site-domain");
        return {
          host: domain.textContent,
          color: getComputedStyle(domain).color,
          width: icon.getBoundingClientRect().width,
          height: icon.getBoundingClientRect().height,
          sameRow: icon.getBoundingClientRect().top === domain.getBoundingClientRect().top,
        };
      }, url);
      assert.deepEqual(badge, {
        host: "example.org", color: "rgb(217, 223, 231)", width: 24, height: 24, sameRow: true,
      }, url);
      const expectedImage = url.includes("bing.com") ? icon : url.includes("duckduckgo.com") ? duckIcon : faviconUrl;
      await page.waitForFunction(({ expectedImage, failFallback }) => {
        const badge = document.querySelector(".bsp-site-icon");
        const image = badge.querySelector("img");
        return failFallback ? !image && badge.textContent === "E" : image?.src === expectedImage && image.naturalWidth > 0;
      }, { timeout: 4000 }, { expectedImage, failFallback }).catch(async error => {
        const icon = await page.$eval(".bsp-site-icon", el => el.innerHTML);
        throw new Error(`${url}: ${icon}`, { cause: error });
      });
      assert.equal(await page.$$eval(".bsp-site-badge", badges => badges.length), 1, url);
      assert.equal(await page.evaluate(() => badgeLayout.pageDomains.set("example.org").count), 1, url);
      await page.evaluate(() => badgeLayout.dispose());
    }
  } finally {
    await browser.close();
  }
});
