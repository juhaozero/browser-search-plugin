import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import puppeteer from "puppeteer-core";

test("first install shows a compact guide with preview and skip actions", async () => {
  const executablePath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].find(existsSync);
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, enableExtensions: true,
    args: process.env.BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-gpu"] : [] });
  try {
    const id = await browser.installExtension(resolve("extension"));
    const target = await browser.waitForTarget(item => item.type() === "service_worker"
      && item.url() === `chrome-extension://${id}/background.js`);
    const worker = await target.worker();
    await worker.evaluate(() => {
      const create = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.create = async options => {
        if (options.url === "https://www.bing.com/search?q=Chrome+extensions") return create({ url: "about:blank#bsp-onboarding-example" });
        throw new Error("Unexpected example URL");
      };
    });
    const popup = await browser.newPage();
    await popup.setViewport({ width: 320, height: 440 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    popup.setDefaultTimeout(5000);
    await popup.waitForSelector("#bsp-onboarding", { visible: true });
    assert.equal(await popup.$eval("#bsp-onboarding-try", el => el.textContent), "一键开启双列并预览");
    assert.equal(await popup.$eval("#bsp-onboarding-skip", el => el.textContent), "跳过");
    assert.equal(await popup.$eval("#bsp-prefs", el => el.hidden), true);
    assert.equal(await popup.$$eval(".bsp-onboarding-icon", icons => icons.filter(icon => icon.checkVisibility()).length), 3);
    assert.equal(await popup.evaluate(() => {
      const button = document.getElementById("bsp-onboarding-skip").getBoundingClientRect();
      return document.documentElement.scrollWidth === innerWidth && button.bottom <= innerHeight;
    }), true);

    const page = await browser.newPage();
    await page.triggerExtensionAction((await browser.extensions()).get(id));
    const toolbarTarget = await browser.waitForTarget(item => item !== popup.target() && item.url() === popup.url(), { timeout: 5000 });
    const toolbarPopup = await toolbarTarget.asPage();
    await toolbarPopup.waitForSelector("#bsp-onboarding-try", { visible: true, timeout: 5000 });
    await toolbarPopup.click("#bsp-onboarding-try");
    await browser.waitForTarget(item => item.url() === "about:blank#bsp-onboarding-example", { timeout: 5000 });
    await popup.reload();
    await popup.waitForSelector("#bsp-prefs", { visible: true });
    assert.equal(await popup.$eval("#bsp-onboarding", el => el.hidden), true);
    assert.equal(await popup.$eval('input[value="double"]', el => el.checked), true);
    assert.deepEqual(await popup.evaluate(() => chrome.storage.local.get("bspOnboarding")), { bspOnboarding: "complete" });

    await popup.evaluate(async () => {
      await chrome.storage.sync.set({ prefs: { columnMode: "single-center" } });
      await chrome.storage.local.set({ bspOnboarding: "pending" });
    });
    await page.bringToFront();
    await page.triggerExtensionAction((await browser.extensions()).get(id));
    const fallbackTarget = await browser.waitForTarget(item =>
      item !== popup.target() && item !== toolbarTarget && item.url() === popup.url(), { timeout: 5000 });
    const fallbackPopup = await fallbackTarget.asPage();
    await fallbackPopup.waitForSelector("#bsp-onboarding-try", { visible: true, timeout: 5000 });
    await fallbackPopup.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = message => message.type === "bsp-finish-onboarding"
        ? Promise.reject(new Error("Could not establish connection. Receiving end does not exist."))
        : send(message);
      const create = chrome.tabs.create.bind(chrome.tabs);
      chrome.tabs.create = options => {
        if (options.url !== "https://www.bing.com/search?q=Chrome+extensions") throw new Error("Unexpected example URL");
        return create({ url: "about:blank#bsp-onboarding-fallback" });
      };
    });
    await fallbackPopup.click("#bsp-onboarding-try");
    await browser.waitForTarget(item => item.url() === "about:blank#bsp-onboarding-fallback", { timeout: 5000 });
    assert.deepEqual(await popup.evaluate(() => chrome.storage.local.get("bspOnboarding")), { bspOnboarding: "complete" });
    assert.equal(await popup.evaluate(async () => (await chrome.storage.sync.get("prefs")).prefs.columnMode), "double");

    await popup.evaluate(async () => {
      await chrome.storage.sync.set({ prefs: { columnMode: "single-center" } });
      await chrome.storage.local.set({ bspOnboarding: "pending" });
    });
    await popup.bringToFront();
    await popup.reload();
    await popup.waitForSelector("#bsp-onboarding-skip", { visible: true });
    const openTabs = (await browser.pages()).length;
    await popup.click("#bsp-onboarding-skip");
    await popup.waitForSelector("#bsp-prefs", { visible: true });
    assert.equal(await popup.$eval('input[value="single-center"]', el => el.checked), true);
    assert.equal((await browser.pages()).length, openTabs);
    await popup.reload();
    await popup.waitForSelector("#bsp-prefs", { visible: true });
    assert.equal(await popup.$eval("#bsp-onboarding", el => el.hidden), true);
  } finally {
    await browser.close();
  }
});
