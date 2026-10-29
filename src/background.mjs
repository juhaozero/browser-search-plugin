import { openResultTab } from "./result-tabs.mjs";

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "bsp-open-result") return false;
  void openResultTab(message, sender, chrome).then(respond);
  return true;
});
