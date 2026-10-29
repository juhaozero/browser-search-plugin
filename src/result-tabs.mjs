import { isDesktopWebSearch } from "./search-session.mjs";

export function safeWebUrl(href, base) {
  try {
    const url = new URL(href, base);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function openResultTab(message, sender, api) {
  if (sender.id !== api.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)
    || !isDesktopWebSearch(sender.url) || message?.type !== "bsp-open-result"
    || !["new-tab", "background"].includes(message.mode) || typeof message.url !== "string") return { ok: false };
  const url = safeWebUrl(message.url);
  if (!url) return { ok: false };
  try {
    await api.tabs.create({ url, active: message.mode === "new-tab", openerTabId: sender.tab.id, windowId: sender.tab.windowId });
    return { ok: true };
  } catch { return { ok: false }; }
}
