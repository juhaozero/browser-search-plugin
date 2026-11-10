# SearchLayout Privacy Policy

Last updated: 2026-10-30

This Privacy Policy describes how the **SearchLayout** Chrome extension (“the Extension”) handles information when you install and use it.

SearchLayout helps you read Google, Bing, and DuckDuckGo **desktop web search result pages** with single- or dual-column layouts and optional automatic pagination.

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
- Independent folding preferences for People Also Ask, video carousels and featured snippets; quick presets apply presentation preferences

These preferences are saved with `chrome.storage` (`sync` when available, otherwise `local`). If Chrome Sync is enabled for extensions, Chrome may sync these preferences across your signed-in devices according to Google’s own policies. The Extension developer does not receive a copy of these preferences on a developer-operated server.

### 2. Search result page content (processed on-device only)

On matching Google, Bing, DuckDuckGo, and Baidu **desktop web search result pages**, the Extension’s content script may:

- Read the structure of organic search result items on the page
- Rearrange those items in the page DOM for the selected layout
- Copy recognized related-search links into an optional fixed bar. When site badges are enabled and a result icon is unavailable, the browser may request `/favicon.ico` directly from the destination site over HTTPS, without sending a referrer. The extension uses the domain's initial when no image loads.
- Open the organic result title you click in the current, new, or background tab according to your preference. The requested destination URL passes to the extension service worker to create that tab
- Optionally change visited-link colors with CSS `:visited`. The browser manages visited status. With this preference enabled, the Extension can also mark matching titles after a Bing title click or after it successfully creates a new or background tab. The destination URL stays in the current page session’s memory and is cleared on reload or session teardown. The Extension does not read browsing history, write these records to storage, or confirm that the destination loaded
- Show or hide sidebar / AI containers, and locally fold or dim explicitly marked advertising areas without deleting organic results
- Fold recognized People Also Ask, video carousels and featured snippets in the local DOM, retaining the original nodes and allowing expansion
- Hide organic results whose destination domains match rules you enter under Advanced in the popup, including subdomains and newly appended results. These rules and hidden counts are exchanged locally between the popup and the active search tab and remain in memory only, are never saved to Chrome storage or synced, and clear on reload, search navigation or session teardown. Domain filtering and block folding make no additional network requests and do not block the engine's own requests
- Optionally load more results in your browser through a same-origin request with your existing session cookies on Google, Bing, and Baidu, or through DuckDuckGo’s native More Results button

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
- **Access to Google, Bing, DuckDuckGo, and Baidu desktop search results** through content scripts that arrange results and, on supported engines, optionally load more in the browser

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
- The Extension interacts with Google, Bing, DuckDuckGo, and Baidu pages in your browser. Those services are governed by their own privacy policies.
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

**SearchLayout** 是一款 Chrome 扩展，用于在 Google、Bing 和 DuckDuckGo 的桌面网页搜索结果页上调整布局，并可选自动翻页。DuckDuckGo 自动翻页使用页面自带的「更多结果」按钮。
百度桌面网页搜索也支持调整布局和自动翻页。扩展在百度首页监听站内搜索跳转，并在进入结果页时应用布局。自动翻页在浏览器中请求百度分页链接。

- **不**向开发者自有服务器上传你的搜索词、浏览历史或页面内容。
- 偏好设置保存在 `chrome.storage`；若开启 Chrome 同步，可能随你的 Chrome 账号同步到其他设备。
- 预设和特殊模块折叠开关属于上述偏好；「大家还在问」、视频轮播和精选摘要仅本地折叠，可展开。本页域名隐藏在弹窗「高级」中管理，规则和隐藏数量仅在内存保留，通过弹窗与当前搜索页之间的本地消息读写，刷新、搜索导航或会话释放后清除，不保存、不同步、不上传。过滤与折叠不新增网络请求，也不阻止搜索引擎自身加载。
- 仅在匹配的搜索结果页本地读取/改写结果条目，并可能在浏览器内请求下一页结果以拼接显示。
- 可选固定相关搜索与显示站点徽标。开启站点徽标后，原生图标不可用时，浏览器可能直接向目标站发起 HTTPS `/favicon.ico` 请求，请求不带来源页地址。图片无法加载时显示域名首字母。按偏好打开结果时，目标地址传给扩展后台用于创建标签。
- 已访问弱化使用 CSS。点击 Bing 结果标题，或扩展成功创建新标签／后台标签后，可在当前结果页标记相同目标的标题。目标地址仅保留在当前页会话内存中，刷新或会话释放后清除。扩展不读取浏览历史、不写入这些记录，也不确认目标页面是否加载成功。
- **不**出售用户数据，也**不**将数据用于广告或与核心功能无关的用途。

如有疑问，请通过上述 GitHub Issues 联系。
