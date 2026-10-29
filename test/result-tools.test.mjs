import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { createSearchSession } from "../src/search-session.mjs";
import { createResultTools, destinationUrl, relatedLinks, titleLink } from "../src/result-tools.mjs";
import { openResultTab, safeWebUrl } from "../src/result-tabs.mjs";
import { DEFAULT_PREFS, normalizePrefs, createMemoryPrefsStore } from "../src/preferences.mjs";
import { mountPopup, paint, readForm } from "../src/popup.mjs";
import { bootSearchPage } from "../src/boot.mjs";
import { searchPage, resultMarkup } from "./fixtures/search-page.mjs";

const base = "https://www.google.com/search?q=test";
const prefs = { ...DEFAULT_PREFS, autoPage: false, pinRelated: true, emphasizeSite: true, dimVisited: true, resultOpenMode: "background" };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("打开方式偏好校验、弹窗保存和语言切换", async () => {
  assert.deepEqual(normalizePrefs({ resultOpenMode: "bad", pinRelated: 1, emphasizeSite: "yes", dimVisited: null }), DEFAULT_PREFS);
  const { document } = parseHTML(readFileSync("extension/popup.html", "utf8"));
  const store = createMemoryPrefsStore(prefs);
  const popup = await mountPopup(document, { prefsStore: store });
  assert.deepEqual(readForm(document), prefs);
  await popup.setLocale("zh");
  assert.equal(document.querySelector('[data-i18n="pinRelated"]').textContent, "底部固定相关搜索");
  for (const mode of ["original", "current", "new-tab", "background"]) {
    paint(document, { ...prefs, resultOpenMode: mode });
    await popup.commit();
    assert.equal((await store.load()).resultOpenMode, mode);
  }
});

test("站点地址解码与安全协议边界", () => {
  const { document } = parseHTML('<div class="g"><h2>Other section heading</h2><a href="https://example.org"><h3>Result title</h3></a></div>');
  assert.equal(titleLink(document.querySelector(".g")).getAttribute("href"), "https://example.org");
  assert.equal(destinationUrl("/url?q=https%3A%2F%2Fexample.org%2Ffoo", base, "google"), "https://example.org/foo");
  assert.equal(destinationUrl("/url?url=https%3A%2F%2Fexample.org", base, "google"), "https://example.org/");
  const encoded = Buffer.from("https://example.org/test").toString("base64url");
  assert.equal(destinationUrl(`/ck/a?u=a1${encoded}`, "https://www.bing.com/search?q=test", "bing"), "https://example.org/test");
  assert.equal(destinationUrl("/url?q=javascript%3Aalert(1)", base, "google"), null);
  for (const href of ["javascript:alert(1)", "data:text/html,hello", "chrome://settings", "https://user:pass@example.org", "invalid"]) {
    assert.equal(safeWebUrl(href), null);
  }
  assert.equal(safeWebUrl("/foo", base), "https://www.google.com/foo");
});

test("后台标签消息只接受本扩展、顶层搜索页和安全 URL", async () => {
  const created = [];
  const api = { runtime: { id: "test" }, tabs: { create: async props => created.push(props) } };
  const sender = { id: "test", frameId: 0, url: base, tab: { id: 10, windowId: 3 } };
  const message = { type: "bsp-open-result", mode: "background", url: "https://example.org/" };
  for (const invalid of [{ ...sender, id: "other" }, { ...sender, frameId: 1 }, { ...sender, url: "https://example.org/search?q=test" }, { ...sender, tab: null }]) {
    assert.deepEqual(await openResultTab(message, invalid, api), { ok: false });
  }
  for (const invalid of [{ ...message, mode: "current" }, { ...message, url: "javascript:alert(1)" }, { ...message, url: 3 }, {}]) {
    assert.deepEqual(await openResultTab(invalid, sender, api), { ok: false });
  }
  assert.equal(created.length, 0);
  assert.deepEqual(await openResultTab(message, sender, api), { ok: true });
  assert.deepEqual(created[0], { url: message.url, active: false, openerTabId: 10, windowId: 3 });
  await openResultTab({ ...message, mode: "new-tab" }, sender, api);
  assert.equal(created[1].active, true);
  api.tabs.create = async () => { throw new Error("closed window"); };
  assert.deepEqual(await openResultTab(message, sender, api), { ok: false });
});

test("相关搜索只复制明确区域内的同站查询，过滤分页、跨站和重复项", () => {
  const { document } = parseHTML(`<html><body><a href="/search?q=outside">Outside</a><div id="botstuff">
    <a href="/search?q=related&amp;hl=zh"> Related words </a><a href="/search?q=related">duplicate</a>
    <a href="/search?q=test&amp;start=10">Next</a><a href="/search?q=other&amp;start=10">Other page</a>
    <a href="https://example.org/search?q=evil">external</a><a href="javascript:void(0)">Unsafe</a>
    <a href="/images?q=other">Images</a></div></body></html>`);
  assert.deepEqual(relatedLinks(document, base, "google"), [{ href: "https://www.google.com/search?q=related&hl=zh", label: "Related words" }]);
});

test("双引擎站点强化、固定条、动态追加与关闭释放保留原节点", () => {
  for (const engine of ["google", "bing"]) {
    const url = `https://www.${engine}.com/search?q=test`;
    const { document } = parseHTML(searchPage({ engine }));
    const related = document.createElement("div");
    related.id = engine === "google" ? "bres" : "related-native";
    related.className = engine === "bing" ? "b_rs" : "";
    related.innerHTML = '<a href="/search?q=related">Related query</a>';
    document.body.appendChild(related);
    const session = createSearchSession(document, url, prefs);
    const first = session.items[0];
    const title = titleLink(first);
    const tools = createResultTools(document, url, session);
    tools.refresh(prefs, "en");
    assert.equal(document.querySelectorAll(".bsp-site-badge").length, 3);
    assert.equal(first.querySelector(".bsp-site-domain").textContent, "example.com");
    assert.equal(document.querySelector("#bsp-related").getAttribute("aria-label"), "Related searches");
    assert.equal(related.firstChild.textContent, "Related query");
    const originalBar = document.getElementById("bsp-related");
    tools.refresh(prefs, "en");
    assert.equal(document.getElementById("bsp-related"), originalBar);
    originalBar.remove();
    tools.refresh(prefs, "en");
    assert.ok(document.getElementById("bsp-related"));
    tools.refresh(prefs, "zh");
    assert.equal(document.querySelector("#bsp-related strong").textContent, "相关搜索");
    const fresh = parseHTML(searchPage({ engine })).document;
    fresh.querySelector(engine === "bing" ? "#b_results" : "#rso").innerHTML = resultMarkup(engine, 100);
    session.apply({ autoPage: true });
    session.ingest(fresh); tools.refresh();
    assert.equal(document.querySelectorAll(".bsp-site-badge").length, 4);
    tools.refresh({ ...prefs, emphasizeSite: false, pinRelated: false, dimVisited: false }, "en");
    assert.equal(document.querySelector(".bsp-site-badge"), null);
    assert.equal(document.querySelector("#bsp-related"), null);
    assert.equal(titleLink(first), title);
    tools.dispose(); session.dispose();
    assert.equal(document.querySelector("[data-bsp-result]"), null);
    assert.equal(document.documentElement.hasAttribute("data-bsp-dim-visited"), false);
    assert.equal(document.querySelector("#bsp-related-space"), null);
  }
});

test("结果打开仅拦截普通标题点击，保留组合键、广告与导航，失败可再次尝试", async () => {
  const { document, window } = parseHTML(searchPage());
  const session = createSearchSession(document, base, prefs);
  const messages = [];
  let fail = false;
  const tools = createResultTools(document, base, session, async message => {
    messages.push(message);
    if (fail) throw new Error("unavailable");
    return { ok: true };
  });
  tools.refresh(prefs, "zh");
  const link = titleLink(session.items[0]);
  function click(target, flags = {}) {
    const event = new window.Event("click", { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, ...flags });
    target.dispatchEvent(event); return event;
  }
  for (const flags of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) assert.equal(click(link, flags).defaultPrevented, false);
  assert.equal(click(document.querySelector("#unrelated-nav a")).defaultPrevented, false);
  assert.equal(click(link).defaultPrevented, true);
  await tick();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].mode, "background");
  fail = true; click(link); await tick();
  assert.match(document.querySelector('[role="alert"]').textContent, /打开标签失败/);
  fail = false; click(link); await tick();
  assert.equal(document.querySelector('[role="alert"]'), null);
  tools.refresh({ ...prefs, resultOpenMode: "original" }, "en");
  assert.equal(click(link).defaultPrevented, false);
  tools.dispose();
  assert.equal(click(link).defaultPrevented, false);
});

test("boot 翻页新结果立即带站点强化，关闭和释放清理全部效果", async () => {
  const { document } = parseHTML(searchPage());
  const boot = await bootSearchPage(document, base, {}, { attachScroll: false, watchDom: false,
    prefs: { ...prefs, autoPage: true }, fetchDocument: async () => parseHTML(searchPage({ count: 1 }).replaceAll("result/0", "result/new")).document,
  });
  await boot.pager.check({ scrollY: 0, viewportHeight: 1000, listBottom: 900 });
  assert.equal(document.querySelectorAll(".bsp-site-badge").length, 4);
  boot.dispose();
  assert.equal(document.querySelector(".bsp-site-badge, [data-bsp-result]"), null);
});

test("新标签与后台标签成功后标记当前页，失败、关闭偏好和释放不产生标记", async () => {
  for (const engine of ["google", "bing"]) {
    const url = `https://www.${engine}.com/search?q=test`;
    const { document, window } = parseHTML(searchPage({ engine }));
    const session = createSearchSession(document, url, prefs);
    let respond;
    const tools = createResultTools(document, url, session, () => new Promise(resolve => { respond = resolve; }));
    const click = link => {
      const event = new window.Event("click", { bubbles: true, cancelable: true });
      event.button = 0; link.dispatchEvent(event);
    };
    for (const [index, mode] of ["background", "new-tab"].entries()) {
      tools.refresh({ ...prefs, resultOpenMode: mode }, "en");
      const link = titleLink(session.items[index]);
      click(link); await tick();
      assert.equal(link.hasAttribute("data-bsp-opened"), false);
      respond({ ok: false }); await tick();
      assert.equal(link.hasAttribute("data-bsp-opened"), false);
      click(link); await tick(); respond({ ok: true }); await tick();
      assert.equal(link.getAttribute("data-bsp-opened"), "true");
    }
    const first = session.items[0];
    const duplicate = first.cloneNode(true);
    duplicate.querySelector("[data-bsp-opened]").removeAttribute("data-bsp-opened");
    const link = titleLink(duplicate);
    const destination = "https://example.com/result/0";
    link.setAttribute("href", engine === "google" ? `/url?q=${encodeURIComponent(destination)}` : `/ck/a?u=a1${Buffer.from(destination).toString("base64url")}`);
    first.parentNode.appendChild(duplicate);
    tools.refresh();
    assert.equal(link.getAttribute("data-bsp-opened"), "true");
    link.setAttribute("href", "https://example.org/changed"); tools.refresh();
    assert.equal(link.hasAttribute("data-bsp-opened"), false);
    tools.refresh({ ...prefs, dimVisited: false }, "en");
    assert.equal(document.documentElement.getAttribute("data-bsp-dim-visited"), "false");
    const last = titleLink(session.items[2]);
    click(last); await tick(); respond({ ok: true }); await tick();
    assert.equal(last.hasAttribute("data-bsp-opened"), false);
    tools.refresh(prefs, "en");
    click(last); await tick(); tools.dispose(); respond({ ok: true }); await tick();
    assert.equal(document.querySelector("[data-bsp-opened]"), null);
    const restarted = createResultTools(document, url, session);
    restarted.refresh(prefs, "en");
    assert.equal(document.querySelector("[data-bsp-opened]"), null);
    restarted.dispose(); session.dispose();
  }
});

test("已访问只改变允许的颜色，不新增历史权限", () => {
  const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
  assert.deepEqual(manifest.permissions, ["storage"]);
  const css = readFileSync("extension/content.css", "utf8");
  const rules = [...css.matchAll(/[^{}]*:visited[^{}]*\{([^{}]*)\}/g)];
  assert.equal(rules.length, 2);
  for (const [, declarations] of rules) assert.match(declarations.trim(), /^color:\s*#[\da-f]+\s*!important;$/);
});
