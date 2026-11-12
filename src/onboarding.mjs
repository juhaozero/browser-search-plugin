import { createChromePrefsStore } from "./preferences.mjs";

const STATE_KEY = "bspOnboarding";
const FINISH_MESSAGE = "bsp-finish-onboarding";
const DEMO_URL = "https://www.bing.com/search?q=Chrome+extensions";

/** @param {typeof chrome.storage.local | undefined} local */
export async function hasPendingOnboarding(local) {
  try {
    return (await local?.get(STATE_KEY))?.[STATE_KEY] === "pending";
  } catch {
    return false;
  }
}

/** @param {typeof chrome} api */
export function registerOnboarding(api) {
  const local = api.storage.local;
  let finishing;
  api.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install") void local.set({ [STATE_KEY]: "pending" }).catch(() => {});
  });

  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== FINISH_MESSAGE || !["preview", "skip"].includes(message.action) || sender.id !== api.runtime.id
      || sender.url !== api.runtime.getURL("popup.html") || (sender.frameId ?? 0) !== 0) return false;
    finishing ??= finishPendingOnboarding(api, message.action).finally(() => { finishing = undefined; });
    void finishing.then(respond);
    return true;
  });
}

/**
 * @param {typeof chrome} api
 * @param {"preview" | "skip"} action
 */
async function finishPendingOnboarding(api, action) {
  const locks = globalThis.navigator?.locks;
  try {
    return await (locks ? locks.request(STATE_KEY, finish) : finish());
  } catch {
    return "storage";
  }

  async function finish() {
    const local = api.storage.local;
    if ((await local.get(STATE_KEY))?.[STATE_KEY] !== "pending") return "ok";
    if (action === "preview") {
      const store = createChromePrefsStore(api.storage);
      const prefs = await store.load();
      if (prefs.columnMode !== "double") await store.save({ ...prefs, columnMode: "double" });
    }
    // Opening an active tab closes the popup, so persist completion first.
    await local.set({ [STATE_KEY]: "complete" });
    if (action === "preview") {
      try {
        await api.tabs.create({ url: DEMO_URL });
      } catch {
        await local.set({ [STATE_KEY]: "pending" });
        return "preview";
      }
    }
    return "ok";
  }
}

/**
 * @param {typeof chrome} api
 * @param {"preview" | "skip"} action
 */
export async function finishOnboarding(api, action) {
  let result;
  try {
    result = await api.runtime.sendMessage({ type: FINISH_MESSAGE, action });
  } catch (error) {
    if (!/Receiving end does not exist|message port closed before a response/i.test(error?.message ?? "")) {
      return "connection";
    }
  }
  // The popup can open the tab in its own window if the worker could not open one.
  if (result?.ok === true) return "ok";
  if (result == null || result === "preview" || result?.ok === false) return finishPendingOnboarding(api, action);
  return result;
}
