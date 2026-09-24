import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import {
  beginLayoutGate,
  endLayoutGate,
  isLayoutGateReady,
  waitForDocumentLoad,
  waitForResultsShell,
} from "../src/layout-gate.mjs";
import { bootSearchPage } from "../src/content-boot.mjs";

test("manifest 在 document_start 注入，降低原生布局闪现", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.content_scripts[0].run_at, "document_start");
});

test("CSS 在 bsp-ready 前隐藏整页，不露出原始排版", () => {
  const css = readFileSync(new URL("../extension/content.css", import.meta.url), "utf8");
  assert.match(css, /html:not\(\[data-bsp-ready\]\)\s+body\s*\{[^}]*opacity:\s*0\s*!important/);
  // 不能用 visibility：会让正在输入的搜索框失焦
  assert.doesNotMatch(css, /html:not\(\[data-bsp-ready\]\)[^{]*\{[^}]*visibility:\s*hidden/);
});

test("不排版的页面不走结果容器等待，立即放行门控", () => {
  const src = readFileSync(new URL("../src/content.mjs", import.meta.url), "utf8");
  const start = src.indexOf("async function start");
  const earlyExit = src.indexOf("!isDesktopWebSearch(location.href)", start);
  const waitShell = src.indexOf("waitForResultsShell(document)", start);
  assert.ok(earlyExit > start && earlyExit < waitShell);
});

test("门控 begin/end 切换 data-bsp-ready", () => {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  beginLayoutGate(document);
  assert.equal(isLayoutGateReady(document), false);
  assert.equal(document.documentElement.dataset.bspReady, undefined);
  endLayoutGate(document);
  assert.equal(isLayoutGateReady(document), true);
  assert.equal(document.documentElement.dataset.bspReady, "1");
});

test("boot 完成后应结束门控，避免结果永久隐藏", async () => {
  const { document } = parseHTML(`<!doctype html><html><body>
    <div id="rso">
      <div class="g"><h3><a href="https://example.com/a">甲</a></h3><div class="VwiC3b">摘要</div></div>
    </div>
  </body></html>`);
  beginLayoutGate(document);
  assert.equal(isLayoutGateReady(document), false);

  const boot = await bootSearchPage(
    document,
    "https://www.google.com/search?q=chrome",
    { viewportWidth: 1200 },
    { attachScroll: false, watchDom: false },
  );
  assert.ok(boot);
  assert.equal(isLayoutGateReady(document), true);
  assert.ok(document.getElementById("bsp-results"));
  boot.dispose();
});

test("waitForDocumentLoad 在已就绪文档上立即返回", async () => {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  await waitForDocumentLoad(document, 50);
});

test("waitForResultsShell 能等到后插入的结果根", async () => {
  const { document } = parseHTML("<!doctype html><html><body><div id='wrap'></div></body></html>");
  const pending = waitForResultsShell(document, 500);
  setTimeout(() => {
    const box = document.createElement("div");
    box.id = "b_results";
    document.getElementById("wrap").appendChild(box);
  }, 20);
  assert.equal(await pending, true);
});
