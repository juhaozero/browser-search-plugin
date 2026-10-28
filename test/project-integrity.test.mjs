import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LAYOUT_CSS_VARIABLES } from "../src/layout-constants.mjs";
import { BING_HOSTS, GOOGLE_HOSTS, SEARCH_MATCHES } from "../src/search-hosts.mjs";
import { isDesktopWebSearch } from "../src/search-session.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("manifest、package 和 lockfile 使用同一版本", () => {
  const manifest = JSON.parse(read("../extension/manifest.json"));
  const pkg = JSON.parse(read("../package.json"));
  const lock = JSON.parse(read("../package-lock.json"));
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[""].version, manifest.version);
});

test("内容脚本权限与运行时主机策略一致，不接受未授权的 Google/Bing 域名", () => {
  const manifest = JSON.parse(read("../extension/manifest.json"));
  assert.deepEqual(manifest.content_scripts[0].matches, SEARCH_MATCHES);
  for (const host of [...GOOGLE_HOSTS, ...BING_HOSTS]) {
    assert.equal(isDesktopWebSearch(`https://${host}/search?q=test`), true, host);
  }
  for (const host of ["google.invalid", "www.google.zz", "maps.google.com", "www.google.com.example.com", "www.bing.com.example.com"]) {
    assert.equal(isDesktopWebSearch(`https://${host}/search?q=test`), false, host);
  }
  assert.equal(isDesktopWebSearch("http://www.google.com/search?q=test"), false);
});

test("生成的 CSS 布局尺寸与 JS 权威值保持一致", () => {
  const css = read("../extension/content.css");
  for (const [name, value] of Object.entries(LAYOUT_CSS_VARIABLES)) {
    assert.ok(css.includes(`${name}: ${value};`), `${name} is stale; run npm run sync`);
  }
});
