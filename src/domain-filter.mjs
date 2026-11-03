
export const DOMAIN_GROUPS = {
  domainVisual: ["pinterest.com", "pinterest.co.uk", "pinterest.jp"],
  domainCommunity: ["zhihu.com", "quora.com", "reddit.com"],
  domainSocial: ["facebook.com", "instagram.com", "x.com", "twitter.com"],
};

export function parseDomains(value) {
  const domains = new Set();
  for (const token of value.trim().split(/[\s,，、;；]+/).filter(Boolean)) {
    // Accept hostnames only, never paths, credentials, ports or wildcard patterns.
    if (/[/\\:@?#*]/.test(token)) return null;
    let host;
    try { host = new URL(`https://${token}`).hostname.toLowerCase().replace(/\.$/, ""); }
    catch { return null; }
    if (host.length > 253 || !host.includes(".") || !host.split(".").every(label =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    domains.add(host);
  }
  return [...domains];
}

export function matchesDomain(host, domain) {
  host = host.toLowerCase().replace(/\.$/, "");
  return host === domain || host.endsWith(`.${domain}`);
}

// Rules exist only in this content-controller instance; never persisted.
export function createDomainFilter(document, session, getDestination) {
  let domains = [];
  const hidden = new Map();
  return { refresh, dispose, get: () => ({ ok: true, domains: [...domains], count: hidden.size }), set };

  function set(value) {
    const next = typeof value === "string" ? parseDomains(value) : null;
    if (!next) return { ok: false, error: "invalid" };
    domains = next;
    refresh();
    return { ok: true, domains: [...domains], count: hidden.size };
  }

  function refresh() {
    const items = new Set(session.items);
    for (const [item, previous] of hidden) {
      if (!items.has(item) || !shouldHide(item)) { restore(item, previous); hidden.delete(item); }
    }
    for (const item of items) {
      if (!shouldHide(item)) continue;
      if (!hidden.has(item)) hidden.set(item, item.getAttribute("data-bsp-domain-hidden"));
      item.setAttribute("data-bsp-domain-hidden", "true");
    }
  }

  function shouldHide(item) {
    const destination = getDestination(item);
    if (!destination) return false;
    return domains.some(domain => matchesDomain(new URL(destination).hostname, domain));
  }

  function restore(item, previous) {
    if (previous === null) item.removeAttribute("data-bsp-domain-hidden");
    else item.setAttribute("data-bsp-domain-hidden", previous);
  }

  function dispose() {
    for (const [item, previous] of hidden) restore(item, previous);
    hidden.clear();
    domains = [];
  }
}
