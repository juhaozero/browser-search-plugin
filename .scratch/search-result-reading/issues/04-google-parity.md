Status: ready-for-agent

# 谷歌桌面网页搜索：高亮、列模式、自动翻页与百度对等

## What to build

把百度结果页上已经能用的阅读行为接到谷歌桌面版网页搜索。覆盖 `google.com`、`www.google.com`，以及带国家或地区后缀的桌面域上的 `/search` 网页结果。不做镜像站、自定义搜索、手机版和图片等垂类。

谷歌与百度共用同一套偏好。列模式只搬结果条目；高亮只涂标题和摘要；自动翻页由扩展取下一页接到后面，规则与百度相同（去重、最多再接 10 页、加载中、加载失败、页码留着）。

## Acceptance criteria

- [ ] `www.google.com` 与带国家或地区后缀的桌面 `/search` 网页搜索结果页启用高亮和当前列模式
- [ ] 谷歌搜索首页、手机版、图片（含 `tbm=isch` 或等价的图片结果）不被改动
- [ ] 高亮只在谷歌结果条目的标题和摘要上，知识卡和广告上没有
- [ ] 非原始列模式只搬走谷歌结果条目；切回原始模式时，本页原有结果条目回到原位
- [ ] 滚到底部会取下一页并接上，去重，最多再接 10 页
- [ ] 取页时显示「加载中」，失败时短暂显示「加载失败」，不自动连着重试，离开后再滚回可重试
- [ ] 谷歌页码留着，点页码按谷歌原来的方式打开那一页

## Blocked by

- `.scratch/search-result-reading/issues/02-baidu-extension-shell.md`
- `.scratch/search-result-reading/issues/03-baidu-auto-page.md`
