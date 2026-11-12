import { openResultTab } from "./result-tabs.mjs";
import { registerOnboarding } from "./onboarding.mjs";

registerOnboarding(chrome);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "bsp-open-result") return false;
  void openResultTab(message, sender, chrome).then(respond);
  return true;
});
