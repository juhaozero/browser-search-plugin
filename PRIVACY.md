# SearchLayout Privacy Policy

Last updated: 2026-10-28

This Privacy Policy describes how the **SearchLayout** Chrome extension (“the Extension”) handles information when you install and use it.

SearchLayout helps you read Google and Bing **desktop web search result pages** more easily by rearranging organic results into single- or dual-column layouts and optionally appending the next page of results on the same page.

---

## Summary

- We do **not** operate a backend server for this Extension.
- We do **not** sell, rent, or share your personal data with third parties for advertising or analytics.
- Preferences are stored in Chrome’s storage (and may sync with your Chrome account if sync is enabled).
- Page content on search result pages is processed **locally in your browser** only to provide layout and auto-page features.

---

## Information We Access or Store

### 1. Extension preferences (stored locally / Chrome Sync)

The Extension stores settings you choose in the popup, for example:

- Column layout mode (original / single / single-center / double)
- Auto-page on/off
- Card density and maximum column width
- Sidebar and AI Overview visibility, and local ad presentation (unchanged / collapsed / dimmed)
- Pages per batch, bottom threshold, automatic continuation, and interface language
- Result opening mode, pinned related searches, site identity badges, and visited-link color preference

These preferences are saved with `chrome.storage` (`sync` when available, otherwise `local`). If Chrome Sync is enabled for extensions, Chrome may sync these preferences across your signed-in devices according to Google’s own policies. The Extension developer does not receive a copy of these preferences on a developer-operated server.

### 2. Search result page content (processed on-device only)

On matching Google and Bing **desktop web search result pages**, the Extension’s content script may:

- Read the structure of organic search result items on the page
- Rearrange those items in the page DOM for the selected layout
- Copy recognized related-search links into an optional fixed bar and show domains with existing site icons (or a locally generated initial); no external favicon service is used
- Open the organic result title you click in the current, new, or background tab according to your preference. The requested destination URL passes to the extension service worker to create that tab
- Optionally change visited-link colors with CSS `:visited`. The browser manages visited status; the Extension does not read browsing history or inspect visited state. With this preference enabled, successful new/background tab creation also keeps the destination URL in the current page session’s memory to mark matching titles as opened. These temporary records are not written to Chrome storage or synced, and are cleared on reload or session teardown. Creating a tab does not confirm its destination loaded successfully
- Show or hide sidebar / AI containers, and locally fold or dim explicitly marked advertising areas without deleting organic results
- Optionally request the **next search results page in your browser** (same-origin request with your existing session cookies) to append more organic results on the current page

This processing happens locally in your browser to provide the Extension’s features. Search queries, result titles/snippets/URLs, and page HTML are **not** uploaded to a developer-operated server by the Extension.

### 3. What we do not collect

The Extension does not intentionally collect or transmit to the developer:

- Personally identifiable information (name, email, phone, etc.)
- Payment or financial information
- Health information
- Precise location
- Browsing history outside the supported search result pages
- Authentication credentials

---

## Permissions and Site Access

The Extension requests:

- **`storage`** — to save and load your preferences
- **Access to Google/Bing desktop search result pages** (via content scripts) — only to rearrange results and optionally load the next results page in-browser

It does not request broad access such as all websites.

Opening a new/background tab does not require the `tabs` permission. The Extension requests neither `tabs` nor `history` permission.

---

## How Information Is Used

Information accessed or stored by the Extension is used solely to:

- Apply and remember your layout / auto-page preferences
- Improve readability of search result pages as described above

We do **not** use Extension data for advertising, creditworthiness decisions, or unrelated product purposes.

---

## Sharing and Third Parties

- We do **not** sell user data.
- We do **not** share Extension data with third-party advertisers or data brokers.
- The Extension interacts with Google/Bing pages in your browser as part of normal browsing; those services are governed by their own privacy policies.
- Chrome Sync (if enabled) is operated by Google and governed by Google’s privacy policy.

---

## Data Retention

- Preferences remain in `chrome.storage` until you change them, clear extension/site data, or uninstall the Extension.
- Because we do not run a developer backend that stores your search content, there is no server-side retention of search page content by us.

---

## Your Choices

You can:

- Change or reset preferences in the Extension popup
- Disable or uninstall the Extension at any time in `chrome://extensions`
- Clear Chrome extension / browsing data as provided by Chrome
- Turn Chrome Sync on or off for your account

---

## Children’s Privacy

The Extension is a general-purpose productivity tool and is not directed at children. We do not knowingly collect personal information from children.

---

## Changes to This Policy

We may update this Privacy Policy when the Extension’s behavior or legal requirements change. The “Last updated” date at the top will be revised accordingly. Continued use of the Extension after an update means you acknowledge the revised policy.

---

## Contact

Questions about this Privacy Policy or the Extension:

- GitHub Issues: https://github.com/juhaozero/browser-search-plugin/issues
- Repository: https://github.com/juhaozero/browser-search-plugin

---

## 中文摘要

**SearchLayout** 是一款 Chrome 扩展，用于在谷歌和必应的桌面网页搜索结果页上调整结果布局，并可选自动翻页。

- **不**向开发者自有服务器上传你的搜索词、浏览历史或页面内容。
- 偏好设置保存在 `chrome.storage`；若开启 Chrome 同步，可能随你的 Chrome 账号同步到其他设备。
- 仅在匹配的搜索结果页本地读取/改写结果条目，并可能在浏览器内请求下一页结果以拼接显示。
- 可选固定相关搜索、强化域名与已有图标；不接入第三方图标服务。按偏好打开结果时，目标地址传给扩展后台用于创建标签。
- 已访问弱化使用 CSS，并在新标签／后台标签创建成功后补充当前页「已打开」标记：目标地址仅保留在当前页会话内存中，刷新或会话释放后清除，不写入存储、不随账号同步。创建标签不代表目标页面加载成功；不读取历史或检测浏览器已访问状态，不申请 `history` 或 `tabs` 权限。
- **不**出售用户数据，也**不**将数据用于广告或与核心功能无关的用途。

如有疑问，请通过上述 GitHub Issues 联系。
