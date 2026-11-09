import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { DEFAULT_PREFS, PREF_PRESETS, applyPreset, createMemoryPrefsStore } from "../src/preferences.mjs";
import { createLocaleStore } from "../src/i18n.mjs";
import { mountPopup } from "../src/popup.mjs";
import { bootSearchPage } from "../src/boot.mjs";
import { matchesDomain, parseDomains } from "../src/domain-filter.mjs";
import { createPageDomainsClient } from "../src/popup-domains.mjs";

test("高级中的域名规则通过当前页消息应用，重开弹窗读回，不进入偏好存储", async () => {
  let domains = [];
  const store = createMemoryPrefsStore();
  const sent = [];
  const client = createPageDomainsClient({
    query: async () => [{ id: 17 }],
    sendMessage: async (id, message, options) => {
      assert.equal(id, 17);
      assert.equal(options.frameId, 0);
      sent.push(message);
      if (message.action === "set") domains = parseDomains(message.value);
      return { ok: true, domains, count: domains.length };
    },
  });
  const open = async () => {
    const { document } = parseHTML(readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8"));
    await mountPopup(document, { prefsStore: store, localeStore: createLocaleStore(), pageDomainsClient: client });
    return document;
  };
  let document = await open();
  document.querySelector('[data-domain-group="domainCommunity"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(domains.includes("zhihu.com"));
  assert.deepEqual(await store.load(), DEFAULT_PREFS);
  document = await open();
  assert.match(document.querySelector('[name="pageDomains"]').value, /zhihu.com/);
  const before = sent.length;
  document.querySelector('[name="pageDomains"]').value = "*.com";
  document.querySelector('[data-domain-apply]').click();
  assert.equal(sent.length, before);
  assert.equal(document.querySelector('[name="pageDomains"]').getAttribute('aria-invalid'), 'true');
  document.querySelector('[data-domain-clear]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(domains, []);
});

test("预设只调整翻页与外观、保留独立布局和导航偏好，高级默认关闭", async () => {
  const { document } = parseHTML(readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8"));
  const initial = { ...DEFAULT_PREFS, columnMode: "double", resultOpenMode: "background", pagesPerBatch: 3, autoPage: false };
  const store = createMemoryPrefsStore(initial);
  const popup = await mountPopup(document, { prefsStore: store, localeStore: createLocaleStore() });
  assert.equal(document.querySelector(".bsp-all-advanced").hasAttribute("open"), false);
  assert.deepEqual(
    Array.from(document.querySelectorAll("#bsp-prefs > section"), section => section.getAttribute("aria-labelledby")),
    ["bsp-presets-title", "bsp-layout-title"],
  );
  assert.ok(document.querySelector("#bsp-clean-title").closest(".bsp-all-advanced"));
  assert.ok(document.querySelector('[name="autoPage"]').closest(".bsp-all-advanced"));
  assert.ok(document.querySelector('[name="pageDomains"]').closest(".bsp-all-advanced"));
  const customPreset = document.getElementById("bsp-preset-custom");
  assert.equal(customPreset.hasAttribute("hidden"), false);
  assert.equal(customPreset.textContent, "Custom");
  for (const name of Object.keys(PREF_PRESETS)) {
    document.querySelector(`[data-preset="${name}"]`).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await store.load(), applyPreset(initial, name));
    assert.equal(document.querySelector(`[data-preset="${name}"]`).getAttribute("aria-pressed"), "true");
    assert.equal(customPreset.hasAttribute("hidden"), true);
    for (const columnMode of ["original", "single", "single-center", "double"]) {
      const saved = applyPreset({ ...initial, columnMode }, name);
      assert.equal(saved.columnMode, columnMode);
      assert.equal(saved.resultOpenMode, "background");
    }
  }
  assert.equal(applyPreset(initial, "simple").pagesPerBatch, 10);
  assert.equal(applyPreset(initial, "reading").pagesPerBatch, 5);
  assert.equal(applyPreset(initial, "minimal").autoPage, false);
  for (const input of document.querySelectorAll('[name="columnMode"]')) input.checked = input.value === "single";
  await popup.commit();
  assert.equal(document.querySelector('[data-preset="minimal"]').getAttribute("aria-pressed"), "true");
  await popup.setLocale("zh");
  assert.equal(document.querySelector('[data-preset="minimal"]').textContent, "极简干扰");
  const minimalPreset = document.querySelector('[data-preset="minimal"]');
  for (const name of ["collapsePaa", "collapseVideos", "collapseSnippets"]) {
    const input = document.querySelector(`[name="${name}"]`);
    input.checked = false;
    input.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await store.load())[name], false);
    assert.equal(minimalPreset.getAttribute("aria-pressed"), "false");
    assert.equal(customPreset.hasAttribute("hidden"), false);
    assert.equal(customPreset.textContent, "自定义");

    minimalPreset.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(minimalPreset.getAttribute("aria-pressed"), "true");
    assert.equal(customPreset.hasAttribute("hidden"), true);
  }
});

test("域名规范化、子域边界、无效输入及国际化域名", () => {
  assert.deepEqual(parseDomains("Pinterest.COM，zhihu.com pinterest.com"), ["pinterest.com", "zhihu.com"]);
  assert.deepEqual(parseDomains("例子.中国"), ["xn--fsqu00a.xn--fiqs8s"]);
  assert.deepEqual(parseDomains(""), []);
  for (const raw of ["*.com", "https://zhihu.com/a", "foo", "a..com", "foo.com:443", "user@foo.com", "-a.com"]) assert.equal(parseDomains(raw), null, raw);
  assert.equal(matchesDomain("www.zhihu.com", "zhihu.com"), true);
  assert.equal(matchesDomain("zhihu.com.evil.test", "zhihu.com"), false);
  assert.equal(matchesDomain("notzhihu.com", "zhihu.com"), false);
});

for (const engine of ["google", "bing"]) {
  const base = `https://www.${engine}.com/search?q=test`;
  const card = (host, id) => engine === "google"
    ? `<div class="g" id="${id}"><a href="https://${host}/a"><h3>${id}</h3></a></div>`
    : `<li class="b_algo" id="${id}"><h2><a href="https://${host}/a">${id}</a></h2></li>`;
  const page = content => engine === "google" ? `<div id="rso">${content}</div>` : `<ol id="b_results">${content}</ol>`;
  test(`${engine} 本页过滤处理真实目标、追加结果、布局切换、恢复和重新启动`, async () => {
    const { document } = parseHTML(`<html><body>${page(card("www.zhihu.com", "hidden") + card("notzhihu.com", "kept"))}</body></html>`);
    const boot = await bootSearchPage(document, base, {}, { prefs: { autoPage: true }, attachScroll: false, watchDom: false });
    assert.equal(document.querySelector("#bsp-domain-filter"), null);
    boot.pageDomains.set("zhihu.com");
    assert.equal(document.querySelector("#hidden").dataset.bspDomainHidden, "true");
    assert.equal(document.querySelector("#kept").hasAttribute("data-bsp-domain-hidden"), false);
    assert.equal(boot.pageDomains.set("*.com").ok, false);
    assert.equal(document.querySelector("#hidden").dataset.bspDomainHidden, "true");
    const target = engine === "google" ? "https://www.google.com/url?q=https%3A%2F%2Fzhihu.com%2Fnew" : `https://www.bing.com/ck/a?u=a1${Buffer.from("https://zhihu.com/new").toString("base64url")}`;
    const next = parseHTML(page(card("zhihu.com", "late"))).document;
    next.querySelector("a").setAttribute("href", target);
    boot.session.ingest(next);
    boot.applyPrefs({ autoPage: false, columnMode: "original" });
    assert.equal(document.querySelector("#late").dataset.bspDomainHidden, "true");
    boot.pageDomains.set("");
    assert.equal(document.querySelector("[data-bsp-domain-hidden]"), null);
    boot.dispose();
    assert.equal(document.querySelector("#bsp-domain-filter"), null);
    const reboot = await bootSearchPage(document, base, {}, { attachScroll: false, watchDom: false });
    assert.deepEqual(reboot.pageDomains.get().domains, []);
    reboot.dispose();
  });

  test(`${engine} 三类块独立折叠、保留节点事件与展开状态，关闭和释放可恢复`, async () => {
    const special = engine === "google"
      ? '<div class="MjjYud" id="paa"><div class="related-question-pair"><button>Question</button></div></div><div class="g" id="videos" data-video-carousel><a href="https://example.com/video"><h3>Video</h3></a></div><div class="g" id="snippet" data-featured-snippet><a href="https://example.com/snippet"><h3>Snippet</h3></a></div>'
      : '<li class="b_ans b_paa" id="paa"><button>Question</button></li><li class="b_ans b_vid" id="videos">Videos</li><li class="b_ans b_snippet" id="snippet">Answer</li>';
    const { document } = parseHTML(`<html><body>${page(special + card("example.com", "organic"))}</body></html>`);
    const original = document.querySelector("#paa button");
    let clicks = 0;
    original.addEventListener("click", () => clicks++);
    const prefs = { collapsePaa: true, collapseVideos: true, collapseSnippets: true, autoPage: false };
    const boot = await bootSearchPage(document, base, {}, { prefs, attachScroll: false, watchDom: false });
    assert.equal(boot.session.items.length, 1);
    assert.equal(document.querySelectorAll(".bsp-block-fold").length, 3);
    assert.equal(document.querySelector("#bsp-results #snippet"), null);
    const fold = document.querySelector("#paa details");
    fold.setAttribute("open", "");
    boot.applyPrefs({ ...prefs, collapseVideos: false, columnMode: "double" });
    assert.equal(fold.hasAttribute("open"), true);
    assert.equal(document.querySelector("#videos details"), null);
    assert.ok(document.querySelector("#snippet details"));
    const late = document.createElement("div"); late.setAttribute("data-video-carousel", ""); late.textContent = "Late videos";
    document.getElementById(engine === "google" ? "rso" : "b_results").appendChild(late);
    boot.applyPrefs(prefs);
    assert.ok(late.querySelector("details"));
    original.click(); assert.equal(clicks, 1);
    boot.dispose();
    assert.equal(document.querySelector(".bsp-block-fold"), null);
    assert.equal(document.querySelector("#paa button"), original);
  });
}
