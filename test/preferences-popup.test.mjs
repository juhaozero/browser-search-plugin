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

test("boot 与即时设置共用偏好校验，非法列模式安全回退", async () => {
  for (const raw of [null, "invalid", { columnMode: "unknown", autoPage: "yes" }]) {
    const { document } = parseHTML(googlePage("test"));
    const boot = await bootSearchPage(document, "https://www.google.com/search?q=test", {}, {
      prefsStore: { load: async () => raw }, attachScroll: false, watchDom: false,
    });
    assert.equal(document.getElementById("bsp-results").dataset.mode, DEFAULT_PREFS.columnMode);
    assert.equal(boot.session.autoPage, true);
    boot.applyPrefs({ columnMode: "double", autoPage: false });
    boot.applyPrefs({ columnMode: "unknown", autoPage: "no" });
    assert.equal(document.getElementById("bsp-results").dataset.mode, DEFAULT_PREFS.columnMode);
    assert.equal(boot.pager.enabled, true);
    boot.dispose();
  }
});

test("状态条使用用户 locale，并在语言切换时即时更新，保留搜索页 lang", async () => {
  const localeStore = createLocaleStore();
  await localeStore.save("zh");
  const { document } = parseHTML(googlePage("test"));
  document.documentElement.lang = "en";
  const boot = await bootSearchPage(document, "https://www.google.com/search?q=test", {}, {
    localeStore, attachScroll: false, watchDom: false,
    fetchDocument: async () => { throw new Error("offline"); },
  });
  await boot.pager.check({ scrollY: 0, viewportHeight: 800, listBottom: 900 });
  assert.equal(document.querySelector("#bsp-status button").textContent, "重试");
  await localeStore.save("en");
  assert.equal(document.querySelector("#bsp-status button").textContent, "Retry");
  assert.equal(document.documentElement.lang, "en");
  boot.dispose();
  await localeStore.save("zh");
  assert.equal(document.getElementById("bsp-status"), null);
});

test("locale storage 变更监听过滤无关事件并可解除", () => {
  const listeners = new Set();
  const storage = { onChanged: {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
  } };
  const store = createLocaleStore(storage);
  const values = [];
  const unsubscribe = store.subscribe(value => values.push(value));
  const notify = (changes, area) => { for (const listener of listeners) listener(changes, area); };
  notify({ uiLocale: { newValue: "zh" } }, "sync");
  notify({ prefs: { newValue: {} } }, "sync");
  notify({ uiLocale: { newValue: "en" } }, "session");
  notify({ uiLocale: { newValue: "en" } }, "local");
  unsubscribe();
  assert.equal(listeners.size, 0);
  assert.deepEqual(values, ["zh", "en"]);
});

test("默认偏好是单列居中、自动翻页开", () => {
  assert.deepEqual(normalizePrefs({}), DEFAULT_PREFS);
  assert.deepEqual(DEFAULT_PREFS, {
    columnMode: "single-center",
    autoPage: true,
    cardDensity: "comfortable", maxColumnWidth: 0,
    googleSidebar: true, bingSidebar: false, showAI: true, adsMode: "original",
    pagesPerBatch: 10, nearBottomPx: 800, autoContinue: false,
    resultOpenMode: "original", pinRelated: false, emphasizeSite: false, dimVisited: false,
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
    ...DEFAULT_PREFS,
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

test("弹窗可切换列模式和自动翻页，并显示翻页参数", async () => {
  const store = createMemoryPrefsStore();
  const { document } = parseHTML(popupHtml());
  const popup = await mountPopup(document, { prefsStore: store, localeStore: createLocaleStore() });
  assert.equal(document.querySelector("input[name='columnMode'][value='single-center']").checked, true);
  assert.equal(document.querySelector("input[name='autoPage']").checked, true);
  assertNoNode(document.querySelector("input[name='highlight']"));
  assert.equal(document.querySelector("input[name='pagesPerBatch']").value, "10");
  assert.equal(document.querySelector("input[name='nearBottomPx']").value, "800");

  for (const input of document.querySelectorAll("input[name='columnMode']")) {
    input.checked = input.value === "double";
  }
  document.querySelector("input[name='autoPage']").checked = false;
  await popup.commit();
  assert.deepEqual(await store.load(), {
    ...DEFAULT_PREFS,
    columnMode: "double",
    autoPage: false,
  });
  assert.deepEqual(readForm(document), {
    ...DEFAULT_PREFS,
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
  return readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8");
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

