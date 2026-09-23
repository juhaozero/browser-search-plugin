# SearchLayout

Chrome 扩展：把**百度 / 谷歌桌面网页搜索结果**排成更易读的单列或双列，并支持自动翻页。

## 功能

- **列模式**：原始 / 单列 / 单列居中 / 双列（结果以卡片形式排列）
- **自动翻页**：滚到底部时，在同一页接上下一页的自然结果
- **偏好即时生效**：点工具栏图标即可切换；设置保存在 `chrome.storage`，可随 Chrome 账号同步

默认：单列居中 + 自动翻页开启。高亮功能当前关闭。

## 适用范围

仅桌面版**网页搜索结果页**：

| 引擎 | 说明                                                        |
| ---- | ----------------------------------------------------------- |
| 百度 | `www.baidu.com/s*`                                          |
| 谷歌 | `google.com` / `www.google.com` 及常见地区域名的 `/search*` |

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

主要目录：

```text
src/                 # 源码（content / popup / session / boot…）
extension/           # 可加载的扩展目录（manifest、样式、图标、构建产物）
test/                # 测试
scripts/build.mjs    # 构建脚本
PRIVACY.md           # 隐私政策
```

## 权限说明

- `storage`：保存布局与自动翻页偏好
- 内容脚本仅注入百度 / 谷歌搜索结果页，用于改布局与在浏览器内请求下一页结果

扩展**不会**把搜索词或页面内容上传到开发者服务器。详见 [PRIVACY.md](./PRIVACY.md)。

## License

[MIT](./LICENSE)
