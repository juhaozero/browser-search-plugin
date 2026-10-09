import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { bootSearchPage } from "../src/content-boot.mjs";
import {
  DEFAULT_PREFS,
  createChromePrefsStore,
  createMemoryPrefsStore,
  normalizePrefs,
} from "../src/preferences.mjs";
import { DEFAULT_LOCALE, createLocaleStore } from "../src/i18n.mjs";
import { mountPopup, readForm } from "../src/popup.mjs";
import { assertNoNode } from "./assert-dom.mjs";

test("默认偏好是单列居中、自动翻页开", () => {
  assert.deepEqual(normalizePrefs({}), DEFAULT_PREFS);
  assert.deepEqual(DEFAULT_PREFS, {
    columnMode: "single-center",
    autoPage: true,
  });
  assert.equal("highlight" in normalizePrefs({ highlight: true }), false);
});

test("同步存储失败时退回本机保存并读回", async () => {
  const local = { prefs: null };
  const storage = {
    sync: {
      async get() {
        throw new Error("sync down");
      },
      async set() {
        throw new Error("sync down");
      },
    },
    local: {
      async get() {
        return local.prefs ? { prefs: local.prefs } : {};
      },
      async set(next) {
        local.prefs = next.prefs;
      },
    },
    onChanged: {
      addListener() {},
      removeListener() {},
    },
  };
  const store = createChromePrefsStore(storage);
  const saved = await store.save({ columnMode: "double", highlight: true, autoPage: true });
  assert.equal(saved.columnMode, "double");
  assert.deepEqual(await store.load(), {
    columnMode: "double",
    autoPage: true,
  });
  assert.equal("highlight" in saved, false);
});

test("弹窗改偏好后已打开结果页马上重排并尊重开关", async () => {
  const store = createMemoryPrefsStore(DEFAULT_PREFS);
  const { document } = parseHTML(googlePage("chrome"));
  const boot = await bootSearchPage(
    document,
    "https://www.google.com/search?q=chrome",
    { viewportWidth: 1200, parentLeft: 80 },
    { prefsStore: store, attachScroll: false, watchDom: false },
  );
  assert.equal(document.getElementById("bsp-results").dataset.mode, "single-center");

  await store.save({ columnMode: "double", autoPage: false });
  assert.equal(document.getElementById("bsp-results").dataset.mode, "double");
  assert.equal(boot.pager.enabled, false);

  await store.save({ columnMode: "original", autoPage: true });
  assertNoNode(document.getElementById("bsp-results"));
  assert.equal(boot.pager.enabled, true);
  boot.dispose();
});

test("谷歌和必应共用同一套偏好", async () => {
  const store = createMemoryPrefsStore({ columnMode: "single", autoPage: true });
  const google = parseHTML(googlePage("chrome")).document;
  const bing = parseHTML(bingPage("chrome")).document;
  const googleBoot = await bootSearchPage(google, "https://www.google.com/search?q=chrome", {}, { prefsStore: store, attachScroll: false, watchDom: false });
  const bingBoot = await bootSearchPage(bing, "https://www.bing.com/search?q=chrome", {}, { prefsStore: store, attachScroll: false, watchDom: false });
  await store.save({ columnMode: "double", autoPage: true });
  assert.equal(google.getElementById("bsp-results").dataset.mode, "double");
  assert.equal(bing.getElementById("bsp-results").dataset.mode, "double");
  googleBoot.dispose();
  bingBoot.dispose();
});

test("弹窗可四选一列模式并开关自动翻页，没有高亮和页数设置", async () => {
  const store = createMemoryPrefsStore();
  const { document } = parseHTML(popupHtml());
  const popup = await mountPopup(document, { prefsStore: store, localeStore: createLocaleStore() });
  assert.equal(document.querySelector("input[name='columnMode'][value='single-center']").checked, true);
  assert.equal(document.querySelector("input[name='autoPage']").checked, true);
  assertNoNode(document.querySelector("input[name='highlight']"));
  assert.equal(document.body.textContent.includes("页数"), false);
  assertNoNode(document.querySelector("input[name='maxPages']"));

  for (const input of document.querySelectorAll("input[name='columnMode']")) {
    input.checked = input.value === "double";
  }
  document.querySelector("input[name='autoPage']").checked = false;
  await popup.commit();
  assert.deepEqual(await store.load(), {
    columnMode: "double",
    autoPage: false,
  });
  assert.deepEqual(readForm(document), {
    columnMode: "double",
    autoPage: false,
  });
});

test("弹窗默认英文并可切换中文", async () => {
  const store = createMemoryPrefsStore();
  const localeStore = createLocaleStore();
  const { document } = parseHTML(popupHtml());
  const popup = await mountPopup(document, { prefsStore: store, localeStore });
  assert.equal(DEFAULT_LOCALE, "en");
  assert.equal(await popup.getLocale(), "en");
  assert.equal(document.documentElement.lang, "en");
  assert.equal(document.querySelector("[data-i18n='tagline']").textContent, "Cleaner, more readable search layouts");
  assert.equal(document.querySelector("[data-i18n='autoPage']").textContent, "Auto page");
  assert.equal(document.querySelector("[data-locale='en']").getAttribute("aria-pressed"), "true");

  await popup.setLocale("zh");
  assert.equal(await localeStore.load(), "zh");
  assert.equal(document.documentElement.lang, "zh-CN");
  assert.equal(document.querySelector("[data-i18n='tagline']").textContent, "把搜索结果排成更易读的版式");
  assert.equal(document.querySelector("[data-i18n='autoPage']").textContent, "自动翻页");
  assert.equal(document.querySelector("[data-locale='zh']").getAttribute("aria-pressed"), "true");
});

test("清单有弹窗和 storage 权限", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.deepEqual(manifest.permissions, ["storage"]);
});

function popupHtml() {
  return `<!doctype html><html lang="en" data-locale="en"><body>
    <div class="bsp-lang" role="group">
      <button type="button" data-locale="en" data-i18n="langEn" aria-pressed="true">EN</button>
      <button type="button" data-locale="zh" data-i18n="langZh" aria-pressed="false">中文</button>
    </div>
    <p data-i18n="tagline">Cleaner, more readable search layouts</p>
    <form id="bsp-prefs">
      <label><input type="radio" name="columnMode" value="original"><span data-i18n="modeOriginal">Original</span></label>
      <label><input type="radio" name="columnMode" value="single"><span data-i18n="modeSingle">Single</span></label>
      <label><input type="radio" name="columnMode" value="single-center"><span data-i18n="modeSingleCenter">Centered</span></label>
      <label><input type="radio" name="columnMode" value="double"><span data-i18n="modeDouble">Dual</span></label>
      <label><input type="checkbox" name="autoPage"><span data-i18n="autoPage">Auto page</span></label>
    </form>
  </body></html>`;
}

function googlePage(query) {
  return `<!doctype html><html><body>
    <div id="rso"><div class="g">
      <a href="https://example.com/a"><h3>${query}</h3></a>
      <div class="VwiC3b">${query}</div>
    </div></div>
    <a id="pnnext" href="/search?q=chrome&amp;start=10">下一页</a>
  </body></html>`;
}

function bingPage(query) {
  return `<!doctype html><html><body>
    <ol id="b_results">
      <li class="b_algo"><h2><a href="https://example.com/a">${query}</a></h2><div class="b_caption"><p>摘要</p></div></li>
    </ol>
  </body></html>`;
}

