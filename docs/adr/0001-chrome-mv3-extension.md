# 做成 Chrome Manifest V3 扩展，而不是油猴脚本

但交付形态是可加载的 Chrome 扩展（Manifest V3）。扩展只注入桌面版百度和谷歌的网页搜索结果页；偏好用 `chrome.storage.sync`（失败则退回本机）。选扩展而不是用户脚本，是为了弹窗改偏好、站点权限可控，且不必依赖 Tampermonkey。
