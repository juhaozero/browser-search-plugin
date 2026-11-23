import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  actionTitleFor,
  applyColumnModeFromMenu,
  COLUMN_MENU_MODES,
  columnModeFromMenuId,
  GITHUB_MENU_ID,
  GITHUB_REPO_URL,
  menuIdForColumnMode,
  openGitHubFromMenu,
  refreshActionLayoutMenu,
  registerActionLayoutMenu,
} from "../src/action-layout-menu.mjs";
import { DEFAULT_PREFS } from "../src/preferences.mjs";

function createApi(initial = {}) {
  const syncValues = {
    prefs: { ...DEFAULT_PREFS, ...(initial.prefs ?? {}) },
    uiLocale: initial.uiLocale ?? "en",
  };
  const localValues = {};
  /** @type {object[]} */
  const menus = [];
  /** @type {string[]} */
  const createdTabs = [];
  let title = "SearchLayout";
  const listeners = {
    installed: [],
    clicked: [],
    changed: [],
  };

  const storage = {
    sync: {
      get: async (key) => ({ [key]: syncValues[key] }),
      set: async (value) => {
        Object.assign(syncValues, value);
        for (const listener of listeners.changed) listener(Object.fromEntries(
          Object.entries(value).map(([name, next]) => [name, { newValue: next }]),
        ), "sync");
      },
    },
    local: {
      get: async (key) => ({ [key]: localValues[key] }),
      set: async (value) => {
        Object.assign(localValues, value);
      },
    },
    onChanged: {
      addListener(listener) {
        listeners.changed.push(listener);
      },
      removeListener(listener) {
        const index = listeners.changed.indexOf(listener);
        if (index >= 0) listeners.changed.splice(index, 1);
      },
    },
  };

  return {
    syncValues,
    menus,
    createdTabs,
    getTitle: () => title,
    listeners,
    api: {
      runtime: {
        onInstalled: {
          addListener(listener) {
            listeners.installed.push(listener);
          },
        },
      },
      storage,
      tabs: {
        async create({ url }) {
          createdTabs.push(url);
        },
      },
      action: {
        async setTitle({ title: next }) {
          title = next;
        },
      },
      contextMenus: {
        removeAll(callback) {
          menus.length = 0;
          callback?.();
        },
        create(item) {
          menus.push({ ...item });
        },
        onClicked: {
          addListener(listener) {
            listeners.clicked.push(listener);
          },
        },
      },
    },
  };
}

test("menu ids map to the four column modes in popup order", () => {
  assert.deepEqual(COLUMN_MENU_MODES, ["original", "single", "single-center", "double"]);
  assert.equal(menuIdForColumnMode("double"), "bsp-column-double");
  assert.equal(columnModeFromMenuId("bsp-column-single-center"), "single-center");
  assert.equal(columnModeFromMenuId("other"), null);
});

test("action title follows uiLocale and current mode", () => {
  assert.equal(actionTitleFor("en", "double"), "SearchLayout · Dual");
  assert.equal(actionTitleFor("zh", "single-center"), "SearchLayout · 单列居中");
  assert.equal(actionTitleFor("en", "nope"), "SearchLayout · Centered");
});

test("refresh builds radio action menus and sets the hover title", async () => {
  const { api, menus, getTitle, syncValues } = createApi({
    prefs: { columnMode: "single" },
    uiLocale: "zh",
  });
  const result = await refreshActionLayoutMenu(api, {
    load: async () => syncValues.prefs,
  }, {
    load: async () => syncValues.uiLocale,
  });
  assert.equal(result.mode, "single");
  assert.equal(getTitle(), "SearchLayout · 单列");
  assert.deepEqual(menus.map((item) => [item.id, item.title, item.checked, item.type, item.contexts]), [
    ["bsp-column-original", "原始", false, "radio", ["action"]],
    ["bsp-column-single", "单列", true, "radio", ["action"]],
    ["bsp-column-single-center", "单列居中", false, "radio", ["action"]],
    ["bsp-column-double", "双列", false, "radio", ["action"]],
    ["bsp-layout-separator", undefined, undefined, "separator", ["action"]],
    [GITHUB_MENU_ID, "SearchLayout", undefined, undefined, ["action"]],
  ]);
});

test("SearchLayout menu item opens the project repository", async () => {
  const { api, createdTabs } = createApi();
  assert.equal(await openGitHubFromMenu(api), true);
  assert.deepEqual(createdTabs, [GITHUB_REPO_URL]);
});

test("choosing a menu item saves only columnMode and can no-op the current mode", async () => {
  const { api, syncValues } = createApi({ prefs: { columnMode: "original", autoPage: false } });
  const store = {
    load: async () => syncValues.prefs,
    save: async (next) => {
      syncValues.prefs = next;
      return next;
    },
  };
  assert.equal(await applyColumnModeFromMenu(api, store, { menuItemId: "bsp-column-original" }), null);
  assert.equal(syncValues.prefs.columnMode, "original");
  const saved = await applyColumnModeFromMenu(api, store, { menuItemId: "bsp-column-double" });
  assert.equal(saved.columnMode, "double");
  assert.equal(saved.autoPage, false);
  assert.equal(syncValues.prefs.columnMode, "double");
});

test("register wires install, storage changes, and clicks", async () => {
  const { api, menus, createdTabs, getTitle, listeners, syncValues } = createApi({
    prefs: { columnMode: "single-center" },
    uiLocale: "en",
  });
  registerActionLayoutMenu(api);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(menus.some((item) => item.id === "bsp-column-single-center" && item.checked), true);
  assert.equal(getTitle(), "SearchLayout · Centered");

  for (const listener of listeners.clicked) listener({ menuItemId: "bsp-column-double" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(syncValues.prefs.columnMode, "double");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(getTitle(), "SearchLayout · Dual");
  assert.equal(menus.find((item) => item.id === "bsp-column-double")?.checked, true);

  await api.storage.sync.set({ uiLocale: "zh" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(getTitle(), "SearchLayout · 双列");
  assert.equal(menus.find((item) => item.id === "bsp-column-double")?.title, "双列");

  for (const listener of listeners.clicked) listener({ menuItemId: GITHUB_MENU_ID });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(createdTabs, [GITHUB_REPO_URL]);
  assert.equal(syncValues.prefs.columnMode, "double");

  for (const listener of listeners.installed) listener({ reason: "install" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(menus.length, 6);
  assert.equal(menus.at(-1)?.id, GITHUB_MENU_ID);
});

test("manifest requests contextMenus for the toolbar layout menu", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage", "contextMenus"]);
  assert.equal(manifest.action.default_popup, "popup.html");
});
