# SearchLayout

Chrome 扩展：把**谷歌 / 必应桌面网页搜索结果**排成更易读的单列或双列，并支持自动翻页。

![谷歌搜索结果双列布局示意](./extension/store-assets/screenshot-04-dual-column-live.png)

[English](./README.en.md) · [隐私政策](./PRIVACY.md)

## 功能

- **列模式**：原始 / 单列 / 单列居中 / 双列（结果以卡片形式排列）
- **自动翻页**：滚到底部时，在同一页接上下一页的自然结果
- **加载状态**：显示已追加页数；失败后可点击重试；每追加 10 页暂停，可点击继续加载，并提供返回顶部按钮
- **偏好即时生效**：点工具栏图标即可切换；设置保存在 `chrome.storage`，可随 Chrome 账号同步

默认：单列居中 + 自动翻页开启。

## 适用范围

仅桌面版**网页搜索结果页**：

| 引擎 | 说明                                                        |
| ---- | ----------------------------------------------------------- |
| 谷歌 | `google.com` / `www.google.com` 及常见地区域名的 `/search*` |
| 必应 | `www.bing.com` / `cn.bing.com` 的 `/search*`                |

不支持：图片 / 视频 / 资讯 / 地图等垂类、手机版页面、搜索首页或结果落地页。

## 安装（开发加载）

1. 安装依赖并构建：

```bash
npm install
npm run build
```

2. 打开 Chrome → `chrome://extensions`
3. 开启「开发者模式」
4. 「加载已解压的扩展程序」→ 选择本仓库的 `extension` 或 `dist` 目录

修改源码后重新执行 `npm run build`，再在扩展页点击刷新。

## 开发

| 命令            | 说明                                                      |
| --------------- | --------------------------------------------------------- |
| `npm run build` | 用 esbuild 打包 `content.js` / `popup.js`，并产出 `dist/` |
| `npm test`      | 运行 Node 内置测试（linkedom）                            |
| `npm run lint` | ESLint 检查源码、脚本与测试 |
| `npm run sync` | 同步版本、内容脚本域名和 CSS 布局常量 |
| `npm run test:browser` | 本机 Chromium 布局回归 |
| `npm run test:live` | 真实页面验证，先构建；可能被搜索引擎验证页面阻断 |

开发环境要求 Node.js 24+。`npm test` 自动发现 `test/` 下所有 `*.test.mjs`，浏览器测试单独运行。

`extension/manifest.json` 的版本号为唯一来源，发版只修改这里；运行 `npm run sync` 或 `npm run build` 后提交同步的 `package.json` 与 `package-lock.json`。域名权限统一维护在 `src/search-hosts.mjs`，布局尺寸统一维护在 `src/layout-constants.mjs`，构建时同步 manifest 与 CSS 生成区。状态条与弹窗共用 `uiLocale`，切换语言后即时更新。

PR 与推送通过 GitHub Actions 执行 lint、单元测试、构建和生成文件一致性检查。浏览器及真实页面检查可在 Actions 手动运行时勾选。

主要目录：

```text
src/                 # 源码（content / popup / session / boot…）
  boot.mjs           # 会话、偏好、语言与 dispose 装配
  shell-layout.mjs   # 结果壳、列宽与侧栏布局
  nav-chrome.mjs     # 顶栏与导航对齐
  search-field.mjs   # Google 搜索框对齐及还原
  bing-layout.mjs    # Bing 事实行与侧栏处理
  dom-watch.mjs      # 观察器、静默改写与滚动监听
  layout-dom.mjs     # 共用 DOM 几何操作
  content-boot.mjs   # 旧导入路径的兼容导出
extension/           # 可加载的扩展目录（manifest、样式、图标、构建产物）
test/                # 测试
scripts/build.mjs    # 构建脚本
PRIVACY.md           # 隐私政策
```

## 权限说明

- `storage`：保存布局与自动翻页偏好
- 内容脚本仅注谷歌 / 必应搜索结果页，用于改布局与在浏览器内请求下一页结果

扩展**不会**把搜索词或页面内容上传到开发者服务器。详见 [PRIVACY.md](./PRIVACY.md)。

## License

[MIT](./LICENSE)
