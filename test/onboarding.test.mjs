import assert from "node:assert/strict";
import { test } from "node:test";
import { finishOnboarding, hasPendingOnboarding, registerOnboarding } from "../src/onboarding.mjs";

test("onboarding is armed by installation and persists completion after a successful retry", async () => {
  const localValues = {};
  const syncValues = { prefs: { columnMode: "original", autoPage: false } };
  const created = [];
  let onInstalled;
  let onMessage;
  let fail = true;
  const popupUrl = "chrome-extension://test/popup.html";
  const sender = { id: "test", url: popupUrl, frameId: 0 };
  const api = {
    runtime: {
      id: "test",
      getURL: () => popupUrl,
      onInstalled: { addListener: callback => { onInstalled = callback; } },
      onMessage: { addListener: callback => { onMessage = callback; } },
      sendMessage: message => new Promise(resolve => assert.equal(onMessage(message, sender, resolve), true)),
    },
    storage: {
      local: {
        get: async key => ({ [key]: localValues[key] }),
        set: async value => { Object.assign(localValues, value); },
      },
      sync: {
        get: async key => ({ [key]: syncValues[key] }),
        set: async value => { Object.assign(syncValues, value); },
      },
    },
    tabs: {
      async create({ url }) {
        if (fail) throw new Error("Cannot open a tab");
        created.push(url);
      },
    },
  };

  registerOnboarding(api);
  onInstalled({ reason: "update" });
  onInstalled({ reason: "chrome_update" });
  assert.equal(await hasPendingOnboarding(api.storage.local), false);
  assert.deepEqual(localValues, {});
  onInstalled({ reason: "install" });
  assert.equal(await hasPendingOnboarding(api.storage.local), true);
  assert.deepEqual(created, []);
  const preview = { type: "bsp-finish-onboarding", action: "preview" };
  assert.equal(onMessage(preview, { ...sender, url: "https://www.bing.com/search?q=test" }, assert.fail), false);
  assert.equal(await finishOnboarding(api, "preview"), "preview");
  assert.equal(await hasPendingOnboarding(api.storage.local), true);

  fail = false;
  assert.deepEqual(await Promise.all([
    finishOnboarding(api, "preview"), finishOnboarding(api, "preview"),
  ]), ["ok", "ok"]);
  assert.deepEqual(created, ["https://www.bing.com/search?q=Chrome+extensions"]);
  assert.equal(syncValues.prefs.columnMode, "double");
  assert.equal(syncValues.prefs.autoPage, false);
  assert.equal(localValues.bspOnboarding, "complete");
  assert.equal(Object.hasOwn(syncValues, "bspOnboarding"), false);
  onInstalled({ reason: "update" });
  assert.equal(await hasPendingOnboarding(api.storage.local), false);
  assert.equal(await finishOnboarding(api, "preview"), "ok");
  assert.equal(created.length, 1);

  onInstalled({ reason: "install" });
  const priorPrefs = { columnMode: "single-center", autoPage: false };
  syncValues.prefs = priorPrefs;
  assert.equal(await finishOnboarding(api, "skip"), "ok");
  assert.equal(localValues.bspOnboarding, "complete");
  assert.equal(syncValues.prefs, priorPrefs);
  assert.equal(created.length, 1);

  onInstalled({ reason: "install" });
  fail = true;
  const popupApi = { ...api, tabs: { async create({ url }) { created.push(url); } } };
  assert.equal(await finishOnboarding(popupApi, "preview"), "ok");
  assert.equal(localValues.bspOnboarding, "complete");
  assert.equal(created.length, 2);
});
