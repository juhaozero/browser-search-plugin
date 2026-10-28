# 模块重构验证记录

日期：2026-10-28（Asia/Shanghai）。

- ESLint、88 项单元测试与构建通过。
- Chromium 64 组布局场景、240 组顶栏检查通过，覆盖动态内容、还原和观察器释放。
- 实际安装重构后的扩展，在真实 Bing 页面验证默认布局、设置即时生效、滚动失败及点击重试通过。测试将页面 `lang` 保持为英文，随后修改 `uiLocale`，状态条即时切换中文和英文通过。
- Bing 下一页返回重复结果时正确停止；本次未重新验证 Google 正常结果页。
- 源码模块无循环导入，版本、域名及 CSS 生成资产的同步操作具有幂等性。
- CI 配置已加入，远端执行需提交并推送后触发。

布局实现由原 `content-boot.mjs` 的 2344 行拆分为 boot、shell、nav、search-field、Bing、DOM observer、共用 DOM 与常量模块。原入口保留 11 行兼容导出；删除 13 个无调用函数，boot 偏好校验复用 `normalizePrefs`。

复验命令：`npm run lint`、`npm test`、`npm run build`、`npm run test:browser`。真实扩展检查先构建，再设置 `LIVE_PACKAGED_ONLY=1` 运行 `npm run test:live`；结果保存在 `.scratch/live/extension-report.json`。
