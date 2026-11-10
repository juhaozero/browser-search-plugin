import { parseDomains } from "./domain-filter.mjs";
import { t } from "./i18n.mjs";

export function createPageDomainsClient(tabs) {
  // Bind this popup to the tab active when it opened, without reading its URL/history.
  let target;
  return async message => {
    target ??= tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.id);
    const tabId = await target;
    if (tabId == null) throw new Error("No active tab");
    return tabs.sendMessage(tabId, { type: "bsp-page-domains", ...message }, { frameId: 0 });
  };
}

export async function mountPopupDomains(document, client) {
  const section = document.getElementById("bsp-domain-controls");
  const input = section.querySelector("input");
  const fieldset = section.querySelector("fieldset");
  const status = section.querySelector("#bsp-domain-error");
  let state = "domainUnavailable";
  let count = 0;
  function render() {
    status.textContent = t(document.documentElement.dataset.locale, state).replace("{count}", String(count));
  }
  async function apply(value = input.value) {
    if (!parseDomains(value)) {
      input.setAttribute("aria-invalid", "true");
      state = "domainInvalid"; render(); return;
    }
    fieldset.disabled = true;
    try {
      const result = await client({ action: "set", value });
      if (!result?.ok) throw new Error("Filter unavailable");
      input.value = result.domains.join(", ");
      input.removeAttribute("aria-invalid");
      count = result.count;
      state = "domainCount";
      fieldset.disabled = false;
    } catch {
      state = "domainUnavailable";
    }
    render();
  }
  section.querySelector("[data-domain-apply]").addEventListener("click", () => { void apply(); });
  section.querySelector("[data-domain-clear]").addEventListener("click", () => { void apply(""); });
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void apply();
  });
  try {
    const result = await client({ action: "get" });
    if (!result?.ok) throw new Error("Filter unavailable");
    input.value = result.domains.join(", ");
    count = result.count;
    state = "domainCount";
    fieldset.disabled = false;
  } catch { /* Keep controls disabled on unsupported pages or after extension reload. */ }
  render();
  return { render };
}
